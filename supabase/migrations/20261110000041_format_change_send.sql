-- Migration 41: the format email goes out through the broadcast path
-- (Anthony, 2026-11-10, Part L).
--
-- The recruit broadcast's plan, claim and record (migrations 37 and 38) take a
-- second key, format_change_YYYY-MM-DD, with its own envelope, which Anthony
-- set for this send: To is Anthony alone, Cc is every other owner with an
-- address, Bcc is every holder's own address (participants.email of everyone
-- holding a reserved or assigned block) minus anything on To or Cc, an
-- owner's alt and the blocklist. Not a holder's cc_email: Anthony said every
-- participant who holds a block, and a cc can be someone else entirely (the
-- 2026-09-08 release asked for by a cc, CLAUDE.md). Prospects are not on it.
-- The plan prints the same arithmetic with P and O at zero: H - T - X = Bcc.
--
-- The claim takes a seventh argument, p_approval: where and when Anthony
-- approved the send, kept on the claim's audit row. It is required for the
-- format email. The six-argument claim stays, unchanged in behaviour, and
-- calls the seven-argument one with no approval, so the recruit broadcast and
-- its suite are untouched.

-- Internal (invoker; only the SECURITY DEFINER functions below call it). Every
-- holder's own address, whether it is on To or Cc (an owner's primary), and
-- why it is out if it is. Recruit exclusion does not apply: it is about
-- recruiting, and a holder is told about his own blocks.
create or replace function email_format_change_addresses()
returns table (address text, active_prospect boolean, holder boolean, on_to boolean, excluded text)
language sql stable
set search_path = public, pg_temp
as $$
  with h as (select distinct x.recipient as a from email_holder_addresses() x where x.via = 'primary'),
       t as (select lower(btrim(o.email)) as a from owners o where nullif(btrim(o.email), '') is not null)
  select h.a,
         false,
         true,
         h.a in (select a from t),
         case
           when h.a in (select a from t) then null
           when h.a in (select email_avd_addresses()) then 'anthony'
           when h.a in (select email_owner_addresses()) then 'owner alt address'
           when exists (select 1 from blocked_address_hashes b where b.hash = address_hash(h.a)) then 'blocked'
         end
    from h
$$;

revoke execute on function email_format_change_addresses() from public, anon, authenticated;

-- The plan for either broadcast. The recruit branch is migration 37's, word
-- for word. The format email's 'to' is Anthony's primary alone and its 'cc'
-- every other owner's primary, both sorted in byte order.
create or replace function admin_email_broadcast_plan(p_event_key text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  perform assert_admin();
  if p_event_key ~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    select jsonb_build_object(
             'event_key', p_event_key,
             'p', count(*) filter (where a.active_prospect),
             'h', count(*) filter (where a.holder),
             'o', count(*) filter (where a.active_prospect and a.holder),
             't', count(*) filter (where a.on_to),
             'x', count(*) filter (where a.excluded is not null),
             'bcc_count', count(*) filter (where not a.on_to and a.excluded is null),
             'to', (select coalesce(jsonb_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C"), '[]'::jsonb)
                      from owners o where nullif(btrim(o.email), '') is not null),
             'bcc', coalesce(jsonb_agg(a.address order by a.address collate "C")
                               filter (where not a.on_to and a.excluded is null), '[]'::jsonb),
             'omitted_owners', (select coalesce(jsonb_agg(o.code order by o.code), '[]'::jsonb)
                                  from owners o where nullif(btrim(o.email), '') is null))
      into v
      from email_recruit_broadcast_addresses() a;
    return v;
  elsif p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$' then
    if not exists (select 1 from owners where code = 'AVD' and nullif(btrim(email), '') is not null) then
      raise exception 'AVD has no address on the owners table; the format email is To Anthony';
    end if;
    select jsonb_build_object(
             'event_key', p_event_key,
             'p', 0,
             'h', count(*),
             'o', 0,
             't', count(*) filter (where a.on_to),
             'x', count(*) filter (where a.excluded is not null),
             'bcc_count', count(*) filter (where not a.on_to and a.excluded is null),
             'to', (select jsonb_build_array(lower(btrim(o.email))) from owners o where o.code = 'AVD'),
             'cc', (select coalesce(jsonb_agg(lower(btrim(o.email)) order by lower(btrim(o.email)) collate "C"), '[]'::jsonb)
                      from owners o where o.code <> 'AVD' and nullif(btrim(o.email), '') is not null),
             'bcc', coalesce(jsonb_agg(a.address order by a.address collate "C")
                               filter (where not a.on_to and a.excluded is null), '[]'::jsonb),
             'omitted_owners', (select coalesce(jsonb_agg(o.code order by o.code), '[]'::jsonb)
                                  from owners o where nullif(btrim(o.email), '') is null))
      into v
      from email_format_change_addresses() a;
    return v;
  end if;
  raise exception 'no broadcast plan for event %', p_event_key;
end $$;

-- Claim every recipient of one broadcast, in one transaction, before the send.
-- Migration 38's claim, with Cc and the approval. For the recruit broadcast
-- Cc is empty and the envelope md5 is unchanged: md5(to | bcc). With a Cc it
-- is md5(to | cc | bcc), the same string src/lib/email/broadcast.ts hashes.
create or replace function admin_email_claim_broadcast(
  p_event_key text,
  p_rendered_sha text,
  p_omit_owners text[],
  p_min_bcc int,
  p_max_bcc int,
  p_actor text,
  p_approval text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan jsonb;
  v_omit text[];
  v_missing text[];
  v_to text[];
  v_cc text[];
  v_bcc text[];
  v_all text[];
  v_n int;
  v_md5 text;
  v_code text;
  v_claim uuid := gen_random_uuid();
  v_format boolean := p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$';
  v_approval text := nullif(btrim(coalesce(p_approval, '')), '');
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if p_event_key !~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' and not v_format then
    raise exception 'not a broadcast event: %', p_event_key;
  end if;
  if v_format and v_approval is null then
    raise exception 'the format email needs the approval: where and when Anthony approved this send';
  end if;
  if coalesce(p_rendered_sha, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'rendered sha must be 64 hex characters';
  end if;
  if p_min_bcc is null or p_max_bcc is null or p_min_bcc < 0 or p_max_bcc < p_min_bcc then
    raise exception 'a Bcc range is required, min no more than max';
  end if;

  -- One claim per broadcast, whoever races it.
  perform pg_advisory_xact_lock(hashtext('admin_email_claim_broadcast:' || p_event_key));
  if exists (select 1 from email_sends s where s.event_key = p_event_key) then
    raise exception 'already claimed: %. A broadcast goes once; check Gmail Sent and admin_email_unsent first.', p_event_key;
  end if;

  -- The one-time override names exactly the owners with no address.
  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}')
    into v_omit
    from unnest(coalesce(p_omit_owners, '{}')) c
   where nullif(btrim(c), '') is not null;
  select coalesce(array_agg(o.code order by o.code), '{}')
    into v_missing
    from owners o
   where nullif(btrim(o.email), '') is null;
  if v_omit is distinct from v_missing then
    raise exception 'refused: owners with no address are {%}; the override names {%}. Name exactly the owners left off, or set their addresses.',
      array_to_string(v_missing, ','), array_to_string(v_omit, ',');
  end if;

  v_plan := admin_email_broadcast_plan(p_event_key);
  v_n := (v_plan ->> 'bcc_count')::int;
  if v_n < p_min_bcc or v_n > p_max_bcc then
    raise exception 'refused: Bcc is %, outside % to %', v_n, p_min_bcc, p_max_bcc;
  end if;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_to from jsonb_array_elements_text(v_plan -> 'to') x;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_cc from jsonb_array_elements_text(coalesce(v_plan -> 'cc', '[]'::jsonb)) x;
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_bcc from jsonb_array_elements_text(v_plan -> 'bcc') x;
  v_all := v_to || v_cc || v_bcc;

  if exists (select 1 from unnest(v_bcc) b where b in (select email_owner_addresses())) then
    raise exception 'refused: an owner address is in Bcc';
  end if;
  if exists (select 1 from unnest(v_all) a join blocked_address_hashes h on h.hash = address_hash(a)) then
    raise exception 'refused: an address on the envelope is on blocked_address_hashes';
  end if;
  if (select count(distinct a) from unnest(v_all) a) <> cardinality(v_all) then
    raise exception 'refused: an address is on the envelope twice';
  end if;
  if v_format then
    -- To is Anthony, Cc is owners' primaries, Bcc is holders: nobody else.
    if v_to is distinct from (select array_agg(lower(btrim(o.email))) from owners o where o.code = 'AVD') then
      raise exception 'refused: the format email is To Anthony alone';
    end if;
    if exists (select 1 from unnest(v_cc) c
                where c not in (select lower(btrim(o.email)) from owners o where o.code <> 'AVD' and nullif(btrim(o.email), '') is not null)) then
      raise exception 'refused: a Cc address is not an owner''s primary';
    end if;
    if exists (select 1 from unnest(v_bcc) b
                where b not in (select h.recipient from email_holder_addresses() h where h.via = 'primary')) then
      raise exception 'refused: a Bcc address is not a holder''s own';
    end if;
  end if;

  insert into email_sends (event_key, recipient, rendered_sha)
  select p_event_key, a, p_rendered_sha from unnest(v_all) a;

  v_md5 := case when cardinality(v_cc) = 0
                then md5(array_to_string(v_to, ',') || '|' || array_to_string(v_bcc, ','))
                else md5(array_to_string(v_to, ',') || '|' || array_to_string(v_cc, ',') || '|' || array_to_string(v_bcc, ','))
           end;

  -- No address in either audit row: the rows in email_sends carry them, under RLS.
  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'email_claim_broadcast', 'email_sends', p_event_key,
          jsonb_build_object('event_key', p_event_key, 'rendered_sha', p_rendered_sha,
                             'to', cardinality(v_to), 'cc', cardinality(v_cc), 'bcc', v_n,
                             'p', v_plan -> 'p', 'h', v_plan -> 'h', 'o', v_plan -> 'o',
                             't', v_plan -> 't', 'x', v_plan -> 'x',
                             'envelope_md5', v_md5, 'omitted_owners', to_jsonb(v_omit),
                             'claim_id', v_claim, 'approval', v_approval),
          v_approval);
  foreach v_code in array v_omit loop
    insert into audit_log (actor, action, target_table, target_id, after, note)
    values (p_actor, 'broadcast_owner_omitted', 'owners', v_code,
            jsonb_build_object('event_key', p_event_key),
            case when v_format
                 then 'no address on the owners table: left off Cc for this one send by an explicit override'
                 else 'no address on the owners table: left off To for this one send by an explicit override' end);
  end loop;

  return jsonb_build_object('event_key', p_event_key, 'claimed', cardinality(v_all),
                            'to', cardinality(v_to), 'cc', cardinality(v_cc), 'bcc', v_n,
                            'envelope_md5', v_md5, 'omitted_owners', to_jsonb(v_omit),
                            'claim_id', v_claim);
end $$;

-- The six-argument claim keeps its signature and its grants: it is the
-- seven-argument one with no approval.
create or replace function admin_email_claim_broadcast(
  p_event_key text,
  p_rendered_sha text,
  p_omit_owners text[],
  p_min_bcc int,
  p_max_bcc int,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return admin_email_claim_broadcast(p_event_key, p_rendered_sha, p_omit_owners, p_min_bcc, p_max_bcc, p_actor, null::text);
end $$;

revoke execute on function admin_email_claim_broadcast(text,text,text[],int,int,text,text) from public, anon;
grant execute on function admin_email_claim_broadcast(text,text,text[],int,int,text,text) to authenticated;

-- Record the one Gmail message id against every recipient of the broadcast.
-- Migration 37's, with the format key allowed.
create or replace function admin_email_record_sent_broadcast(
  p_event_key text,
  p_gmail_message_id text,
  p_rendered_sha text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mid text := nullif(btrim(coalesce(p_gmail_message_id, '')), '');
  v_rows int;
  v_unsent int;
  v_other text;
  v_mismatch int;
  v_status text;
  v_n int;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if v_mid is null then
    raise exception 'gmail message id required';
  end if;
  if p_event_key !~ '^(recruit_broadcast|format_change)_\d{4}-\d{2}-\d{2}$' then
    raise exception 'not a broadcast event: %', p_event_key;
  end if;

  perform 1 from email_sends where event_key = p_event_key for update;
  select count(*),
         count(*) filter (where gmail_message_id is null),
         min(gmail_message_id) filter (where gmail_message_id is not null and gmail_message_id <> v_mid),
         count(*) filter (where rendered_sha <> p_rendered_sha)
    into v_rows, v_unsent, v_other, v_mismatch
    from email_sends
   where event_key = p_event_key;
  if v_rows = 0 then
    raise exception 'no claim for %: a send with no claim is what this ledger exists to prevent', p_event_key;
  end if;
  if v_other is not null then
    raise exception 'already recorded with message %, refusing %', v_other, v_mid;
  end if;
  if v_unsent = 0 then
    return jsonb_build_object('status', 'already_recorded', 'rows', v_rows);
  end if;

  v_status := case when v_mismatch = 0 then 'recorded' else 'sha_mismatch' end;
  update email_sends set gmail_message_id = v_mid, sent_at = now()
   where event_key = p_event_key and gmail_message_id is null;
  get diagnostics v_n = row_count;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor,
          case when v_status = 'recorded' then 'email_sent_broadcast' else 'email_sent_broadcast_sha_mismatch' end,
          'email_sends', p_event_key,
          jsonb_build_object('event_key', p_event_key, 'gmail_message_id', v_mid,
                             'rows', v_n, 'sent_sha', p_rendered_sha));
  return jsonb_build_object('status', v_status, 'rows', v_n);
end $$;
