-- The NEEDS ANTHONY queue.
--
-- The hourly sweep finds things it is not allowed to decide: a Venmo that
-- matches a participant's expected amount, a clean multiple of $500 that
-- matches nobody, a block request buried in a thread. Until now each of
-- those was a line in a report and a round trip. This table is where the
-- lines live instead: one row per item, staged by the sweep through
-- admin_stage_pending, resolved by Anthony at /admin/queue with one click.
--
-- Staging is not deciding. A staged row changes nothing until Anthony
-- approves it, and approving applies it ONLY by calling an existing admin_*
-- RPC (admin_record_payment for a payment, admin_reserve_blocks for a block
-- request). Those RPCs re-check is_admin() and write their own audit rows,
-- exactly as when he presses the same button on their own pages. A kind
-- with no dispatcher is recorded as approved and left for him to apply by
-- hand. Nothing here writes entries, blocks, participants, owners or
-- payments directly, and nothing here can mark a payout paid, release or
-- hold a block, or delete anything.
--
-- The table takes no direct writes from any role. Every other admin table
-- lets the admin session write under RLS and relies on convention to keep
-- writes inside the RPCs; the queue is fed by an automated sweep, so the
-- convention is enforced by grants instead: anon and authenticated get
-- SELECT only (gated by is_admin() under RLS), and the three RPCs are
-- SECURITY DEFINER so they can write a table their caller cannot. Each still
-- starts with assert_admin(): is_admin() reads request.jwt.claims, a session
-- GUC that SECURITY DEFINER does not touch, so the real caller is judged.
-- search_path is pinned, as on every function in this schema.

create table pending_actions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (length(kind) between 1 and 64),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  source_message_id text,                 -- the Gmail message the sweep read
  staged_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text check (resolution in ('approved', 'dismissed')),
  resolution_note text,
  staged_by text,
  resolved_by text,
  -- Resolved and its verdict arrive together or not at all.
  constraint pending_actions_resolution_pair
    check ((resolved_at is null) = (resolution is null))
);

comment on table pending_actions is
  'NEEDS ANTHONY queue: items the sweep staged and did not decide. Written '
  'only through admin_stage_pending / admin_approve_pending / '
  'admin_dismiss_pending. Approve applies an item only via an existing '
  'admin_* RPC.';

-- The sweep runs hourly and will read the same message again until the
-- item is resolved. One open row per kind and message; a resolved row does
-- not block a fresh staging of the same message.
create unique index pending_actions_open_source_key
  on pending_actions (kind, source_message_id)
  where resolved_at is null;

create index pending_actions_open_idx
  on pending_actions (staged_at)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Access. Admin-only reads under RLS; no writes for any client role.
-- ---------------------------------------------------------------------------

alter table pending_actions enable row level security;

create policy admin_read_pending on pending_actions
  for select using (is_admin());

revoke all on pending_actions from public, anon, authenticated;
grant select on pending_actions to authenticated;

-- ---------------------------------------------------------------------------
-- Stage. Called by the sweep (as the admin session) once per item.
-- ---------------------------------------------------------------------------

create or replace function admin_stage_pending(
  p_kind text,
  p_payload jsonb,
  p_source_message_id text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_open uuid;
  v_source text := nullif(p_source_message_id, '');
begin
  perform assert_admin();
  if p_kind is null or length(trim(p_kind)) = 0 or length(p_kind) > 64 then
    raise exception 'kind must be a short label';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload must be a json object';
  end if;
  if v_source is not null then
    select id into v_open from pending_actions
     where kind = p_kind and source_message_id = v_source and resolved_at is null;
    if v_open is not null then
      raise exception 'already staged and still open as %', v_open;
    end if;
  end if;
  insert into pending_actions (kind, payload, source_message_id, staged_by)
  values (p_kind, p_payload, v_source, p_actor)
  returning id into v_id;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'stage_pending', 'pending_actions', v_id::text,
          jsonb_build_object('kind', p_kind, 'source_message_id', v_source,
                             'payload', p_payload));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Approve. Applies the item through the existing RPC its kind maps to, then
-- marks it resolved, in one transaction: if the RPC refuses (block not
-- available, duplicate Venmo txn, participant missing), the row stays open
-- and the error reaches the screen.
--
-- The CASE below is the whole dispatch table. src/lib/pending.ts mirrors it
-- for the page; change both together.
-- ---------------------------------------------------------------------------

create or replace function admin_approve_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions;
  v_applied boolean := false;
  v_rpc text;
  v_result jsonb;
begin
  perform assert_admin();
  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
  end if;

  case r.kind
    when 'payment' then
      -- Payload: participant_id, amount_cents, method, paid_on, and
      -- optionally venmo_txn_id, source_ref, note. A staged payment never
      -- corrects another one, so corrects_payment_id is always null.
      if nullif(r.payload ->> 'participant_id', '') is null then
        raise exception 'payment has no participant_id - dismiss it and record by hand, or restage it attached to someone';
      end if;
      if nullif(r.payload ->> 'amount_cents', '') is null
         or nullif(r.payload ->> 'paid_on', '') is null then
        raise exception 'payment needs amount_cents and paid_on';
      end if;
      v_rpc := 'admin_record_payment';
      v_result := jsonb_build_object('payment_id', admin_record_payment(
        (r.payload ->> 'participant_id')::uuid,
        (r.payload ->> 'amount_cents')::int,
        r.payload ->> 'method',
        (r.payload ->> 'paid_on')::date,
        r.payload ->> 'venmo_txn_id',
        r.payload ->> 'source_ref',
        r.payload ->> 'note',
        null::uuid,
        p_actor));
      v_applied := true;
    when 'reserve_blocks' then
      -- Payload: block_numbers (json array of ints), participant_id, and
      -- optionally method and ref.
      v_rpc := 'admin_reserve_blocks';
      v_result := jsonb_build_object('reserved', admin_reserve_blocks(
        (select array_agg(x::int)
           from jsonb_array_elements_text(r.payload -> 'block_numbers') x),
        (r.payload ->> 'participant_id')::uuid,
        r.payload ->> 'method',
        r.payload ->> 'ref',
        p_actor));
      v_applied := true;
    else
      -- No dispatcher for this kind. Approve records the decision and
      -- applies nothing: the admin does it from the relevant admin page.
      -- Identity conflicts, non-matching multiples and free-form items all
      -- land here on purpose - each needs a human on the right screen.
      v_rpc := null;
  end case;

  update pending_actions
     set resolved_at = now(), resolution = 'approved',
         resolution_note = nullif(p_note, ''), resolved_by = p_actor
   where id = p_id;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'approve_pending', 'pending_actions', p_id::text, to_jsonb(r),
          jsonb_build_object('kind', r.kind, 'applied', v_applied,
                             'dispatched_to', v_rpc, 'result', v_result),
          nullif(p_note, ''));

  return jsonb_build_object('applied', v_applied, 'dispatched_to', v_rpc,
                            'result', v_result);
end $$;

-- ---------------------------------------------------------------------------
-- Dismiss. Resolves the item and applies nothing.
-- ---------------------------------------------------------------------------

create or replace function admin_dismiss_pending(
  p_id uuid,
  p_note text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r pending_actions;
begin
  perform assert_admin();
  select * into r from pending_actions where id = p_id for update;
  if r.id is null then
    raise exception 'pending action % not found', p_id;
  end if;
  if r.resolved_at is not null then
    raise exception 'pending action % is already %', p_id, r.resolution;
  end if;
  update pending_actions
     set resolved_at = now(), resolution = 'dismissed',
         resolution_note = nullif(p_note, ''), resolved_by = p_actor
   where id = p_id;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'dismiss_pending', 'pending_actions', p_id::text, to_jsonb(r),
          jsonb_build_object('kind', r.kind, 'applied', false),
          nullif(p_note, ''));
end $$;

-- Execution rights: signed-in sessions only, same as every other admin RPC.
-- The assert_admin() gate inside each function is what actually authorizes.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_stage_pending(text,jsonb,text,text)',
    'admin_approve_pending(uuid,text,text)',
    'admin_dismiss_pending(uuid,text,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
