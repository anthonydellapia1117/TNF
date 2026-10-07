-- Migration 33: one place every TNF email reads its facts from, and a ledger
-- that makes a second send of the same email impossible.
--
-- Two admin-only tables:
--
--   email_sends  One row per (event_key, recipient). The row is CLAIMED, in the
--                same transaction as its audit row, before the message goes
--                out, and the Gmail message id is recorded after. A claimed row
--                with no message id means "may or may not have gone": it is
--                reported by admin_email_unsent() and is never resent
--                automatically, because the unique key refuses a second claim.
--                A retry therefore cannot double-send.
--
--   prospects    Addresses that may be invited to buy a block, imported from a
--                named sent message with source_ref set to its Gmail id.
--                ADDRESSES NEVER LIVE IN A REPO FILE (the repo is public): they
--                arrive as RPC arguments and exist only in this table. That is
--                why this migration contains no address at all, not even the
--                ones the recruit send excludes; those are marked excluded on
--                their prospect row by admin_exclude_prospect().
--
-- And the functions every renderer reads from, so no email is ever built from
-- a stored list: admin_email_recipients() derives who an event goes to at send
-- time, and admin_email_context() / admin_email_batch() return the live facts
-- an email states. The renderer (src/lib/email) turns facts into words and
-- decides nothing about money or recipients.
--
-- Security, exactly as owners and pending_actions: RLS on is_admin(), anon
-- holds no privilege on either table or any function here, authenticated gets
-- SELECT under RLS and nothing else. Writes go only through the SECURITY
-- DEFINER RPCs below, each of which starts with assert_admin(); is_admin()
-- reads request.jwt.claims, which SECURITY DEFINER does not touch, so the real
-- caller is judged. The internal helpers (email_*) are not executable by any
-- client role at all.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table email_sends (
  id               uuid primary key default gen_random_uuid(),
  event_key        text not null
                   check (event_key ~ '^[a-z0-9][a-z0-9_-]*$' and length(event_key) <= 80),
  recipient        text not null
                   check (recipient = lower(btrim(recipient))
                          and recipient ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  gmail_message_id text,
  rendered_sha     text not null check (rendered_sha ~ '^[0-9a-f]{64}$'),
  claimed_at       timestamptz not null default now(),
  sent_at          timestamptz,
  constraint email_sends_event_recipient_key unique (event_key, recipient),
  constraint email_sends_sent_together check ((gmail_message_id is null) = (sent_at is null))
);

create table prospects (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique
                  check (email = lower(btrim(email))
                         and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  source_ref      text not null check (length(btrim(source_ref)) > 0),
  excluded_at     timestamptz,
  excluded_reason text,
  created_at      timestamptz not null default now(),
  constraint prospects_excluded_together check ((excluded_at is null) = (excluded_reason is null))
);

-- A sweep reply's event key is reply_t<n>_<gmail thread id>. The template
-- number is in the key, so (event_key, recipient) alone would let T2 follow T1
-- on the same thread. One reply per thread, whatever the template and
-- whoever it goes to, is enforced here, where concurrent runs cannot race it.
create unique index email_sends_one_reply_per_thread
  on email_sends ((substring(event_key from '^reply_t[1-7]_(.+)$')))
  where event_key ~ '^reply_t[1-7]_';

alter table email_sends enable row level security;
alter table prospects   enable row level security;

create policy admin_read_email_sends on email_sends for select using (is_admin());
create policy admin_read_prospects   on prospects   for select using (is_admin());

revoke all on email_sends from public, anon, authenticated;
revoke all on prospects   from public, anon, authenticated;
grant select on email_sends to authenticated;
grant select on prospects   to authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers. Plain invoker functions, callable only from the SECURITY
-- DEFINER functions below (which run as the owner); no client role may call
-- them directly.
-- ---------------------------------------------------------------------------

-- Anthony's own addresses, read from his owner row, never written as a literal.
create or replace function email_avd_addresses()
returns setof text
language sql stable
set search_path = public, pg_temp
as $$
  select distinct lower(btrim(a))
    from owners o, unnest(array[o.email, o.alt_email]) as a
   where o.code = 'AVD' and nullif(btrim(a), '') is not null
$$;

-- Every address that reaches a participant holding a committed block (reserved
-- or assigned), lowercased, with how it reaches them. A participant's cc_email
-- reaches a DIFFERENT person than the participant, which the renderer needs to
-- know before it greets anyone by the participant's name.
create or replace function email_holder_addresses()
returns table (recipient text, participant_id uuid, via text)
language sql stable
set search_path = public, pg_temp
as $$
  with holders as (
    select distinct p.id, p.email, p.cc_email
      from participants p
      join blocks b on b.participant_id = p.id
     where b.status in ('reserved', 'assigned')
  )
  select lower(btrim(email)), id, 'primary'::text from holders
   where nullif(btrim(email), '') is not null
  union all
  select lower(btrim(cc_email)), id, 'cc'::text from holders
   where nullif(btrim(cc_email), '') is not null
$$;

-- The facts every TNF email may state, read in one snapshot. Void games are not
-- games. Amounts stay in cents; the renderer formats them.
create or replace function email_common_facts()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'as_of_et', to_char((now() at time zone coalesce(c.timezone, 'America/New_York'))::date, 'YYYY-MM-DD'),
    'timezone', coalesce(c.timezone, 'America/New_York'),
    'price_per_block_cents', c.price_per_block_cents,
    'blocks_total', c.blocks_total,
    'claim_deadline', to_char(c.claim_deadline, 'YYYY-MM-DD'),
    'holiday_halftime_cents', c.holiday_halftime_cents,
    'holiday_final_cents', c.holiday_final_cents,
    'regular_halftime_cents', c.regular_halftime_cents,
    'regular_final_cents', c.regular_final_cents,
    'open_count', (select count(*) from blocks where status = 'available'),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
               'game_no', g.game_no,
               'week', g.week,
               'kickoff_at', g.kickoff_at,
               'date_confirmed', g.date_confirmed,
               'game_type', g.game_type,
               'holiday_label', g.holiday_label,
               'away_team', g.away_team,
               'home_team', g.home_team,
               'network', g.network
             ) order by g.game_no)
        from games g
       where g.status <> 'void'), '[]'::jsonb)
  )
  from config c
  where c.id = 1
$$;

-- What is on file for one address: who it reaches, and every committed block of
-- every participant it reaches, in block order, with the owner who collects for
-- it. The comp flag is deliberately absent: it is admin-only and no email needs
-- it (an assigned block is a block that wins, comped or paid).
create or replace function email_holder_facts(p_recipient text)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with reach as (
    select h.participant_id, h.via
      from email_holder_addresses() h
     where h.recipient = lower(btrim(p_recipient))
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', p.full_name,
               'display_alias', p.display_alias,
               'via', r.via,
               'owner_group', p.owner_group
             ) order by p.full_name, r.via)
        from reach r join participants p on p.id = r.participant_id), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'block_number', b.block_number,
               'status', b.status,
               'owner_group', p.owner_group,
               'owner_full_name', o.full_name
             ) order by b.block_number)
        from blocks b
        join participants p on p.id = b.participant_id
        left join owners o on o.code = p.owner_group
       where b.status in ('reserved', 'assigned')
         and b.participant_id in (select participant_id from reach)), '[]'::jsonb)
  )
$$;

-- What the nightly digest reports, from the database. The threads the sweep
-- could not classify come from Gmail, not from here; the caller adds them.
-- No money total: which pair of figures that line should print is an open
-- question for Anthony, so the digest states the chase list and its count,
-- which come from the same rows and cannot disagree.
create or replace function email_digest_facts()
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with tz as (select coalesce(timezone, 'America/New_York') as z from config where id = 1),
  day_start as (select (date_trunc('day', now() at time zone z)) at time zone z as t from tz)
  select jsonb_build_object(
    'avd_reserved', coalesce((
      select jsonb_agg(jsonb_build_object(
               'block_number', b.block_number,
               'name', coalesce(nullif(b.display_name, ''), p.display_alias, p.full_name)
             ) order by b.block_number)
        from blocks b join participants p on p.id = b.participant_id
       where b.status = 'reserved' and p.owner_group = 'AVD'), '[]'::jsonb),
    'open_queue', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'payload', q.payload)
             order by q.staged_at)
        from pending_actions q where q.resolved_at is null), '[]'::jsonb),
    'writes_today', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action,
                                          'target_table', a.target_table, 'target_id', a.target_id)
             order by a.at)
        from audit_log a
       where a.actor = 'tnf-sweep' and a.at >= (select t from day_start)), '[]'::jsonb),
    'block_counts', (
      select jsonb_build_object(
               'total', count(*),
               'available', count(*) filter (where status = 'available'),
               'reserved',  count(*) filter (where status = 'reserved'),
               'assigned',  count(*) filter (where status = 'assigned'),
               'held',      count(*) filter (where status = 'held'))
        from blocks),
    'over_committed', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(p.display_alias, p.full_name),
                                          'numbered', x.n, 'requested', p.blocks_requested)
             order by p.full_name)
        from participants p
        join (select participant_id, count(*) as n from blocks
               where status in ('reserved', 'assigned') group by participant_id) x
          on x.participant_id = p.id
       where x.n > p.blocks_requested), '[]'::jsonb),
    'last_sweep_activity', (
      select greatest(
               (select max(at) from audit_log where actor = 'tnf-sweep'),
               (select max(staged_at) from pending_actions where staged_by = 'tnf-sweep')))
  )
$$;

revoke execute on function email_avd_addresses()          from public, anon, authenticated;
revoke execute on function email_holder_addresses()       from public, anon, authenticated;
revoke execute on function email_common_facts()           from public, anon, authenticated;
revoke execute on function email_holder_facts(text)       from public, anon, authenticated;
revoke execute on function email_digest_facts()           from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Recipients, derived at send time. Never a stored list.
-- ---------------------------------------------------------------------------

create or replace function admin_email_recipients(p_event_key text)
returns table (recipient text)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();

  if p_event_key like 'holder\_checkin\_%' or p_event_key like 'game\_day\_%' then
    -- Every primary and cc address on a holder of a committed block, one row
    -- per address however many blocks or participants it covers, minus
    -- Anthony's own two. The game-day pack Bccs the same set (it is a draft
    -- Anthony sends himself, so it is never claimed).
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.recipient not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'recruit\_%' then
    -- Prospects not already holding, not excluded, and not Anthony.
    return query
      select p.email
        from prospects p
       where p.excluded_at is null
         and p.email not in (select h.recipient from email_holder_addresses() h)
         and p.email not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'reply\_%' then
    -- A sweep reply (T1-T6) goes to the sender, and only to an address on a
    -- participant row: the sweep writes the roster under its rule 1a before it
    -- replies, so a sender it has not filed cannot be replied to. The event key
    -- carries the thread id, and email_sends_one_reply_per_thread allows one
    -- reply per thread whatever the template: "never twice to the same thread".
    return query
      select distinct a.addr
        from participants p,
             unnest(array[lower(btrim(p.email)), lower(btrim(p.cc_email))]) as a(addr)
       where nullif(a.addr, '') is not null
         and a.addr not in (select email_avd_addresses())
       order by 1;

  else
    raise exception 'no recipient rule for event %', p_event_key;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Render context: the facts one email states, read live.
-- ---------------------------------------------------------------------------

create or replace function admin_email_context(p_event_key text, p_recipient text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_out jsonb;
  v_holder jsonb;
begin
  perform assert_admin();
  v_out := jsonb_build_object('event_key', p_event_key,
                              'recipient', v_r,
                              'common', email_common_facts());

  if p_event_key like 'holder\_checkin\_%' then
    v_holder := email_holder_facts(v_r);
    if jsonb_array_length(v_holder -> 'blocks') = 0 then
      raise exception '% holds no committed block; a holder check-in for it would state something false', v_r;
    end if;
    v_out := v_out || jsonb_build_object('holder', v_holder);
  elsif p_event_key like 'digest\_%' then
    v_out := v_out || jsonb_build_object('digest', email_digest_facts());
  elsif p_event_key like 'reply\_%' then
    -- T1 and T2 turn on whether the block asked for is open at render time,
    -- so the reply context carries every block's status (public on /blocks).
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not on a participant row; the sweep files the sender before it replies', v_r;
    end if;
    v_out := v_out || jsonb_build_object('blocks', (
      select jsonb_agg(jsonb_build_object('block_number', b.block_number, 'status', b.status)
                       order by b.block_number)
        from blocks b));
  end if;

  return v_out;
end $$;

-- One snapshot for a whole send: the common facts once, and one item per
-- derived recipient. A single statement, so every item sees the same database.
create or replace function admin_email_batch(p_event_key text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_items jsonb;
begin
  perform assert_admin();

  if p_event_key like 'holder\_checkin\_%' then
    select coalesce(jsonb_agg(jsonb_build_object('recipient', r.recipient,
                                                 'holder', email_holder_facts(r.recipient))
                              order by r.recipient collate "C"), '[]'::jsonb)
      into v_items
      from admin_email_recipients(p_event_key) r;
  else
    select coalesce(jsonb_agg(jsonb_build_object('recipient', r.recipient)
                              order by r.recipient collate "C"), '[]'::jsonb)
      into v_items
      from admin_email_recipients(p_event_key) r;
  end if;

  return jsonb_build_object('event_key', p_event_key,
                            'common', email_common_facts(),
                            'items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- The send ledger.
-- ---------------------------------------------------------------------------

-- Claim before sending. Refuses an address the event does not derive, so a
-- mistyped or stray address cannot be claimed and therefore cannot be sent to.
-- Refuses a second claim for the same (event, recipient) whatever state the
-- first one is in: that refusal is the whole guarantee against a double send.
create or replace function admin_email_claim(
  p_event_key text,
  p_recipient text,
  p_rendered_sha text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_row email_sends;
  v_id uuid;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;

  select * into v_row from email_sends where event_key = p_event_key and recipient = v_r;
  if found then
    if v_row.gmail_message_id is null then
      raise exception 'already claimed and NOT confirmed sent: event %, recipient %, claimed %. Never resent automatically: check Gmail Sent first.',
        p_event_key, v_r, v_row.claimed_at;
    end if;
    raise exception 'already sent: event %, recipient %, message %', p_event_key, v_r, v_row.gmail_message_id;
  end if;

  if p_event_key ~ '^reply_t[1-7]_' and exists (
       select 1 from email_sends
        where event_key ~ '^reply_t[1-7]_'
          and substring(event_key from '^reply_t[1-7]_(.+)$') = substring(p_event_key from '^reply_t[1-7]_(.+)$')) then
    raise exception 'already replied on this thread: %. Never twice to the same thread.', p_event_key;
  end if;

  if not exists (select 1 from admin_email_recipients(p_event_key) d where d.recipient = v_r) then
    raise exception 'refused: % is not a derived recipient of %', v_r, p_event_key;
  end if;

  insert into email_sends (event_key, recipient, rendered_sha)
  values (p_event_key, v_r, p_rendered_sha)
  returning id into v_id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'email_claim', 'email_sends', v_id::text,
          -- No address: target_id is the email_sends row, which keeps it under RLS.
          jsonb_build_object('event_key', p_event_key, 'rendered_sha', p_rendered_sha));
  return v_id;
end $$;

-- Record the Gmail message id after the send. The message id is a fact about
-- what left the building, so it is recorded even when the sha the sender
-- reports differs from the claimed one; that case returns 'sha_mismatch' and
-- writes its own audit action, and the caller must stop and look.
create or replace function admin_email_record_sent(
  p_event_key text,
  p_recipient text,
  p_gmail_message_id text,
  p_rendered_sha text,
  p_actor text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_mid text := nullif(btrim(coalesce(p_gmail_message_id, '')), '');
  v_row email_sends;
  v_status text;
begin
  perform assert_admin();
  if v_mid is null then
    raise exception 'gmail message id required';
  end if;

  select * into v_row from email_sends
   where event_key = p_event_key and recipient = v_r
   for update;
  if not found then
    raise exception 'no claim for event %, recipient %: a send with no claim row is what this ledger exists to prevent',
      p_event_key, v_r;
  end if;

  if v_row.gmail_message_id is not null then
    if v_row.gmail_message_id = v_mid then
      return 'already_recorded';
    end if;
    raise exception 'already recorded with message %, refusing %', v_row.gmail_message_id, v_mid;
  end if;

  v_status := case when v_row.rendered_sha = p_rendered_sha then 'recorded' else 'sha_mismatch' end;

  update email_sends set gmail_message_id = v_mid, sent_at = now() where id = v_row.id;

  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor,
          case when v_status = 'recorded' then 'email_sent' else 'email_sent_sha_mismatch' end,
          'email_sends', v_row.id::text,
          jsonb_build_object('gmail_message_id', null, 'rendered_sha', v_row.rendered_sha),
          jsonb_build_object('event_key', p_event_key,
                             'gmail_message_id', v_mid, 'sent_sha', p_rendered_sha));
  return v_status;
end $$;

-- Claimed and not confirmed sent. Reported, never resent automatically.
create or replace function admin_email_unsent()
returns table (event_key text, recipient text, claimed_at timestamptz)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();
  return query
    select s.event_key, s.recipient, s.claimed_at
      from email_sends s
     where s.gmail_message_id is null
     order by s.claimed_at;
end $$;

-- ---------------------------------------------------------------------------
-- Prospects.
-- ---------------------------------------------------------------------------

-- Import addresses from one named source. All or nothing: a malformed address
-- aborts the whole import rather than quietly dropping. The audit row carries
-- counts and the source, not the addresses, which live in the table itself.
create or replace function admin_import_prospects(
  p_emails text[],
  p_source_ref text,
  p_actor text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src text := nullif(btrim(coalesce(p_source_ref, '')), '');
  v_clean text[];
  v_bad text;
  v_inserted integer;
begin
  perform assert_admin();
  if v_src is null then
    raise exception 'source_ref required: an import must name the message it came from';
  end if;
  if p_emails is null or cardinality(p_emails) = 0 then
    raise exception 'nothing to import';
  end if;

  select x into v_bad
    from unnest(p_emails) as x
   where lower(btrim(coalesce(x, ''))) !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
   limit 1;
  if found then
    raise exception 'malformed address in import (position not shown); nothing imported';
  end if;

  select array_agg(distinct lower(btrim(x))) into v_clean from unnest(p_emails) as x;

  with ins as (
    insert into prospects (email, source_ref)
    select e, v_src from unnest(v_clean) as e
    on conflict (email) do nothing
    returning 1
  )
  select count(*) into v_inserted from ins;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'import_prospects', 'prospects', v_src,
          jsonb_build_object('source_ref', v_src,
                             'offered', cardinality(p_emails),
                             'distinct', cardinality(v_clean),
                             'inserted', v_inserted,
                             'already_present', cardinality(v_clean) - v_inserted));
  return v_inserted;
end $$;

-- Exclude one prospect from recruitment, with a reason. The row is kept: the
-- exclusion is the record, and a later import cannot quietly re-include it.
create or replace function admin_exclude_prospect(
  p_email text,
  p_reason text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e text := lower(btrim(coalesce(p_email, '')));
  v_row prospects;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required to exclude a prospect';
  end if;

  select * into v_row from prospects where email = v_e for update;
  if not found then
    raise exception 'not a prospect; nothing to exclude';
  end if;
  if v_row.excluded_at is not null then
    return;
  end if;

  update prospects set excluded_at = now(), excluded_reason = btrim(p_reason) where id = v_row.id;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'exclude_prospect', 'prospects', v_row.id::text,
          jsonb_build_object('reason', btrim(p_reason)));
end $$;

-- ---------------------------------------------------------------------------
-- Execution rights: signed-in sessions only, as every other admin RPC. The
-- assert_admin() gate inside each function is what actually authorizes.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_email_recipients(text)',
    'admin_email_context(text,text)',
    'admin_email_batch(text)',
    'admin_email_claim(text,text,text,text)',
    'admin_email_record_sent(text,text,text,text,text)',
    'admin_email_unsent()',
    'admin_import_prospects(text[],text,text)',
    'admin_exclude_prospect(text,text,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
