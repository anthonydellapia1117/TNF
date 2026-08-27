-- Comped blocks: the owner runs the pool and one of his blocks is free.
-- A comped block is a real block in play — it counts toward committed and
-- placed, it sits on the grid, and it is fully eligible to win. It simply
-- contributes $0 to what is owed and $0 to what is collected, and it is
-- never chased for money.
--
-- The payout is FIXED at $44,250 regardless of blocks sold, so a comp does
-- not reduce what goes out — it reduces what comes in. Break-even moves
-- from 89 paying blocks to 90 placed.
--
-- This also removes a latent trap: "committed" used to be derived by
-- dividing money by price. A block that owes $0 would have vanished from
-- that count. Committed is now a real count of blocks, never a function of
-- dollars.

alter table blocks add column comped boolean not null default false;

-- A comp belongs to a block someone actually holds.
alter table blocks add constraint blocks_comped_owned
  check (not comped or participant_id is not null);

-- Releasing a block drops its comp with it, so the constraint holds and a
-- future holder of that number starts owing the normal price.
create or replace function admin_release_block(p_block_number int, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_holder text;
  v_history text;
begin
  perform assert_admin();
  select to_jsonb(b) into v_before from blocks b where b.block_number = p_block_number for update;
  if v_before is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  select coalesce(p.display_alias, p.full_name) into v_holder
    from participants p where p.id = (v_before ->> 'participant_id')::uuid;
  v_history := case
    when v_holder is not null then
      'Released from ' || v_holder || ' on ' || to_char(now(), 'YYYY-MM-DD')
      || case when (v_before ->> 'comped')::boolean then ' · was comped' else '' end
      || case when nullif(v_before ->> 'notes', '') is not null
              then ' · prior note: ' || (v_before ->> 'notes') else '' end
    else nullif(v_before ->> 'notes', '')
  end;
  update blocks
     set participant_id = null, status = 'available', assignment_method = null,
         requested_ref = null, assigned_at = null, comped = false, notes = v_history
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'release_block', 'blocks', p_block_number::text, v_before);
end $$;

-- Comp or un-comp a block. Audited both ways, so it is reversible with a
-- trail rather than a silent edit.
create or replace function admin_set_comped(
  p_block_number int,
  p_comped boolean,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b blocks;
  v_status text;
  v_due bigint;
  v_paid bigint;
begin
  perform assert_admin();
  select * into b from blocks where block_number = p_block_number for update;
  if b.block_number is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  if p_comped and b.participant_id is null then
    raise exception 'block % has no owner — assign it before comping it', p_block_number;
  end if;
  update blocks set comped = p_comped where block_number = p_block_number;
  v_status := b.status;

  -- A comped block owes nothing, so it is settled: reserved becomes
  -- assigned without inventing a payment. Un-comping puts the charge back,
  -- so the block returns to reserved unless the owner has already paid
  -- enough to cover it. The finance view is read AFTER the comp flag flips
  -- so the recomputed due is the one being judged.
  if p_comped and b.status = 'reserved' then
    update blocks
       set status = 'assigned', assigned_at = coalesce(assigned_at, now())
     where block_number = p_block_number;
    v_status := 'assigned';
  elsif not p_comped and b.status = 'assigned' and b.participant_id is not null then
    select amount_due_cents, amount_paid_cents into v_due, v_paid
      from v_participant_finance where participant_id = b.participant_id;
    if coalesce(v_paid, 0) < coalesce(v_due, 0) then
      update blocks set status = 'reserved' where block_number = p_block_number;
      v_status := 'reserved';
    end if;
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor,
          case when p_comped then 'comp_block' else 'uncomp_block' end,
          'blocks', p_block_number::text,
          jsonb_build_object('comped', b.comped, 'status', b.status),
          jsonb_build_object('comped', p_comped, 'status', v_status),
          case when p_comped
               then 'comped — $0 to due and $0 to collected, still fully eligible to win'
               else 'comp removed — block owes the normal price again' end
          || case when v_status <> b.status
                  then format(' · %s → %s', b.status, v_status) else '' end);
end $$;

do $$
begin
  execute 'revoke execute on function admin_set_comped(int,boolean,text) from public, anon';
  execute 'grant execute on function admin_set_comped(int,boolean,text) to authenticated';
end $$;

-- Per-participant finance: a comped block drops out of what is owed, so it
-- never appears in any chase surface. blocks_comped is appended last so
-- create-or-replace keeps the existing column order.
create or replace view v_participant_finance as
select
  p.id as participant_id,
  count(b.block_number) filter (where b.status in ('reserved','assigned'))::int as blocks_held,
  count(b.block_number) filter (where b.status = 'assigned')::int as blocks_assigned,
  (greatest(
     0,
     greatest(
       p.blocks_requested,
       count(b.block_number) filter (where b.status in ('reserved','assigned'))
     )
     - count(b.block_number) filter (where b.status in ('reserved','assigned') and b.comped)
   ))::int * c.price_per_block_cents as amount_due_cents,
  coalesce((select sum(pay.amount_cents) from payments pay where pay.participant_id = p.id), 0)::bigint as amount_paid_cents,
  count(b.block_number) filter (where b.status in ('reserved','assigned') and b.comped)::int as blocks_comped
from participants p
left join blocks b on b.participant_id = p.id
cross join config c
group by p.id, p.blocks_requested, c.price_per_block_cents;

-- Pot. committed_blocks is a COUNT, not money divided by price — a comped
-- block still counts. v_pot carries NO comp marker: it is a public
-- projection, and the comp is admin-only. The house-position panel reads
-- the comped count from the blocks table under admin RLS instead.
--
-- Every figure is inlined from base tables because a
-- security_invoker view nested inside this definer view would evaluate RLS
-- as the session user and collapse to zero for anon (see migration 6).
create or replace view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  (select coalesce(sum(amount_cents),0) from payments)::bigint  as collected_cents,
  (select
     (select coalesce(sum(
        greatest(
          0,
          greatest(
            p.blocks_requested,
            (select count(*) from blocks b
              where b.participant_id = p.id and b.status in ('reserved','assigned'))
          )
          - (select count(*) from blocks b
              where b.participant_id = p.id
                and b.status in ('reserved','assigned') and b.comped)
        )), 0)
      from participants p) * c.price_per_block_cents
   from config c)::bigint as due_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'paid')::bigint as paid_out_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'owed')::bigint as owed_out_cents,
  (select coalesce(sum(
     greatest(
       p.blocks_requested,
       (select count(*) from blocks b
         where b.participant_id = p.id and b.status in ('reserved','assigned'))
     )), 0)
   from participants p)::int as committed_blocks;
