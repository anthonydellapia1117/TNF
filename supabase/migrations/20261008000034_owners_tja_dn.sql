-- Migration 34: two more owners, and the RPCs Anthony's 2026-10-08 changes need.
--
-- 1. TJA (TJ Auletto) and DN (Dom Novelli) become owner codes, shaped like
--    migration 19: every check that lists the codes is dropped and re-added
--    with the ten, and each gets an owners row carrying its code and name
--    only. Addresses are provisioned out of band through
--    admin_set_owner_contact(), never in this file (the repo is public).
--
-- 2. admin_set_owner_contact(): one owner address column, set or cleared,
--    audited without the address. Before this an owner address could only be
--    written by hand outside any RPC.
--
-- 3. admin_remove_prospect(): deletes one prospect row, audited with its id,
--    source and reason and never its address. Used when the row should not
--    exist at all (an owner, or an address that is never stored); an ordinary
--    opt-out stays admin_exclude_prospect(), which keeps the row.
--
-- 4. An owner is never a prospect: the recruit derivation excludes every
--    owner's address, not only Anthony's.
--
-- 5. The digest names every owner with no address, because a broadcast
--    refuses until each owner has one.
--
-- 6. game_list_<message id> and answer_<message id>: a reply to one inbound
--    message, to the address that wrote it. One game_list or answer reply per
--    inbound message, enforced by a unique index whoever it goes to. A
--    T-template reply (reply_t<n>_<thread>) is keyed by thread in its own
--    index; the command's check for a later message from Anthony in the
--    thread is what stops the two families answering the same message.

-- ---------------------------------------------------------------------------
-- 1. The codes.
-- ---------------------------------------------------------------------------

alter table owners drop constraint owners_code_check;
alter table owners add constraint owners_code_check
  check (code = any (array['AVD','RM','MAP','JPOD','EJD','NL','GD','BG','TJA','DN']));

alter table participants drop constraint participants_owner_group_check;
alter table participants add constraint participants_owner_group_check
  check (owner_group in ('AVD','MAP','RM','JPOD','EJD','NL','GD','BG','TJA','DN'));

alter table payments drop constraint payments_collected_by_check;
alter table payments add constraint payments_collected_by_check
  check (collected_by is null
         or collected_by = any (array['AVD','RM','MAP','JPOD','EJD','NL','GD','BG','TJA','DN']));

comment on column participants.owner_group is
  'Owner code: which owner collects this participant''s money and holds it. '
  'Collection responsibility, not provenance. AVD MAP RM JPOD EJD NL GD BG TJA DN; '
  'TJA and DN added 2026-10-08 (migration 34). Each code has a person on the owners table.';

insert into owners (code, full_name) values
  ('TJA', 'TJ Auletto'),
  ('DN',  'Dom Novelli');

-- ---------------------------------------------------------------------------
-- Internal helpers (invoker; no client role may call them).
-- ---------------------------------------------------------------------------

-- Every owner's address, primary and alt, lowercased.
create or replace function email_owner_addresses()
returns setof text
language sql stable
set search_path = public, pg_temp
as $$
  select distinct lower(btrim(a))
    from owners o, unnest(array[o.email, o.alt_email]) as a
   where nullif(btrim(a), '') is not null
$$;

-- Every address the pool knows a person by: participants (primary and cc),
-- prospects, and owners' primary addresses. Never an owner's alt address, and
-- never Anthony's own. This is who a reply to an inbound message may go to.
create or replace function email_pool_addresses()
returns setof text
language sql stable
set search_path = public, pg_temp
as $$
  select a from (
    select lower(btrim(p.email)) as a from participants p
    union select lower(btrim(p.cc_email)) from participants p
    union select r.email from prospects r
    union select lower(btrim(o.email)) from owners o
  ) s
  where nullif(a, '') is not null
    and a not in (select email_avd_addresses())
    and a not in (select lower(btrim(o.alt_email)) from owners o where o.alt_email is not null)
$$;

-- Who an address reaches, for the greeting: every participant whose primary or
-- cc it is, and the owner whose primary it is. The renderer greets only when
-- that is certainly one first name.
create or replace function email_people_for(p_recipient text)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.j order by x.full_name, x.via), '[]'::jsonb)
    from (
      select p.full_name, 'primary'::text as via,
             jsonb_build_object('full_name', p.full_name, 'display_alias', p.display_alias,
                                'via', 'primary', 'owner_group', p.owner_group) as j
        from participants p where lower(btrim(p.email)) = lower(btrim(p_recipient))
      union all
      select p.full_name, 'cc',
             jsonb_build_object('full_name', p.full_name, 'display_alias', p.display_alias,
                                'via', 'cc', 'owner_group', p.owner_group)
        from participants p where lower(btrim(p.cc_email)) = lower(btrim(p_recipient))
      union all
      select o.full_name, 'primary',
             jsonb_build_object('full_name', o.full_name, 'display_alias', null,
                                'via', 'primary', 'owner_group', o.code)
        from owners o
       where lower(btrim(o.email)) = lower(btrim(p_recipient))
    ) x
$$;

-- The digest, as migration 33, plus owners_missing_email.
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
               (select max(staged_at) from pending_actions where staged_by = 'tnf-sweep'))),
    'owners_missing_email', coalesce((
      select jsonb_agg(jsonb_build_object('code', o.code, 'full_name', o.full_name) order by o.code)
        from owners o where nullif(btrim(o.email), '') is null), '[]'::jsonb)
  )
$$;

revoke execute on function email_owner_addresses()   from public, anon, authenticated;
revoke execute on function email_pool_addresses()    from public, anon, authenticated;
revoke execute on function email_people_for(text)    from public, anon, authenticated;
revoke execute on function email_digest_facts()      from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- One game_list or answer reply per inbound message. The key carries the
-- Gmail id of the message being answered; the two events share the one slot.
-- ---------------------------------------------------------------------------

create unique index email_sends_one_reply_per_message
  on email_sends ((substring(event_key from '^(?:game_list|answer)_(.+)$')))
  where event_key ~ '^(game_list|answer)_';

-- ---------------------------------------------------------------------------
-- Recipients and context, as migration 33, plus the two reply events and the
-- all-owner recruit exclusion.
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
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.recipient not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'recruit\_%' then
    -- Prospects not already holding, not excluded, and not an owner: an owner
    -- is never a prospect (Anthony, 2026-10-08), so every owner address is
    -- out, primary and alt, Anthony's included.
    return query
      select p.email
        from prospects p
       where p.excluded_at is null
         and p.email not in (select h.recipient from email_holder_addresses() h)
         and p.email not in (select email_owner_addresses())
         and p.email not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'reply\_%' then
    return query
      select distinct a.addr
        from participants p,
             unnest(array[lower(btrim(p.email)), lower(btrim(p.cc_email))]) as a(addr)
       where nullif(a.addr, '') is not null
         and a.addr not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    -- A reply to one inbound message goes to an address the pool knows: a
    -- participant, a prospect or an owner. The command checks it is the
    -- address that wrote the message.
    return query
      select a.a from email_pool_addresses() a(a) order by 1;

  else
    raise exception 'no recipient rule for event %', p_event_key;
  end if;
end $$;

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
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not on a participant row; the sweep files the sender before it replies', v_r;
    end if;
    v_out := v_out || jsonb_build_object('blocks', (
      select jsonb_agg(jsonb_build_object('block_number', b.block_number, 'status', b.status)
                       order by b.block_number)
        from blocks b));
  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not a participant, prospect or owner address; file the sender before replying', v_r;
    end if;
    v_out := v_out || jsonb_build_object('people', email_people_for(v_r));
  end if;

  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Owner contact.
-- ---------------------------------------------------------------------------

-- Set or clear one address column on one owner row. The audit row says which
-- column changed and whether it was set before and after, never the address:
-- owner addresses live on this table and nowhere else. Refuses an address
-- another owner already uses, in either column, and an alt that is the same
-- owner's primary (a second copy of one address is never stored).
create or replace function admin_set_owner_contact(
  p_code text,
  p_field text,
  p_value text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row owners;
  v_new text := nullif(lower(btrim(coalesce(p_value, ''))), '');
  v_old text;
begin
  perform assert_admin();
  -- One contact write at a time across all owners: the duplicate check below
  -- reads OTHER owners' rows, which a row lock on this one does not cover.
  perform pg_advisory_xact_lock(hashtext('admin_set_owner_contact'));
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if p_field not in ('email', 'alt_email') then
    raise exception 'field must be email or alt_email';
  end if;

  select * into v_row from owners where code = p_code for update;
  if not found then
    raise exception 'no owner %', p_code;
  end if;
  v_old := case p_field when 'email' then v_row.email else v_row.alt_email end;

  if v_new is not null then
    if v_new !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'malformed address (not shown)';
    end if;
    if exists (select 1 from owners o
                where o.code <> p_code
                  and v_new in (lower(btrim(o.email)), lower(btrim(o.alt_email)))) then
      raise exception 'refused: another owner already has that address';
    end if;
    if p_field = 'alt_email' and v_new = lower(btrim(v_row.email)) then
      raise exception 'refused: alt_email would duplicate this owner''s own email';
    end if;
    if p_field = 'email' and v_new = lower(btrim(v_row.alt_email)) then
      raise exception 'refused: email would duplicate this owner''s own alt_email';
    end if;
  end if;

  if v_new is not distinct from lower(btrim(v_old)) then
    return;
  end if;

  if p_field = 'email' then
    update owners set email = v_new where code = p_code;
  else
    update owners set alt_email = v_new where code = p_code;
  end if;

  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'set_owner_contact', 'owners', p_code,
          jsonb_build_object('field', p_field, 'set', v_old is not null),
          jsonb_build_object('field', p_field, 'set', v_new is not null));
end $$;

-- ---------------------------------------------------------------------------
-- 3. Removing a prospect row.
-- ---------------------------------------------------------------------------

-- Delete one prospect. The audit row keeps what the row was (its id, its
-- source, when it came in, whether it was excluded) and why it went, and not
-- the address: a row removed because its address must not be stored would
-- otherwise survive in the log.
create or replace function admin_remove_prospect(
  p_email text,
  p_reason text,
  p_actor text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_e text := lower(btrim(coalesce(p_email, '')));
  v_row prospects;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required to remove a prospect';
  end if;

  select * into v_row from prospects where email = v_e for update;
  if not found then
    raise exception 'not a prospect; nothing to remove';
  end if;

  delete from prospects where id = v_row.id;

  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor, 'remove_prospect', 'prospects', v_row.id::text,
          jsonb_build_object('source_ref', v_row.source_ref,
                             'created_at', v_row.created_at,
                             'excluded_at', v_row.excluded_at,
                             'excluded_reason', v_row.excluded_reason),
          null,
          btrim(p_reason));
  return v_row.id;
end $$;

-- ---------------------------------------------------------------------------
-- Execution rights, as every other admin RPC.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'admin_email_recipients(text)',
    'admin_email_context(text,text)',
    'admin_set_owner_contact(text,text,text,text)',
    'admin_remove_prospect(text,text,text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
