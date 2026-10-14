-- Migration 38: a broadcast send carries proof of its claim (review of PR 25,
-- 2026-10-13).
--
-- The send took the rendered sha and the envelope md5, and the dry run prints
-- both, so a broadcast could go out with no claim behind it and only fail
-- afterwards, at admin_email_record_sent_broadcast. The claim now mints a
-- claim_id that only it returns, kept on its audit row; the command refuses a
-- broadcast send without one, as the per-recipient path refuses a send without
-- the uuid admin_email_claim returns. Same signature, so the grants stand.

-- Claim every recipient of one broadcast, in one transaction, before the send.
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
declare
  v_plan jsonb;
  v_omit text[];
  v_missing text[];
  v_to text[];
  v_bcc text[];
  v_n int;
  v_md5 text;
  v_code text;
  v_claim uuid := gen_random_uuid();
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if p_event_key !~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    raise exception 'not a broadcast event: %', p_event_key;
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
  select coalesce(array_agg(x order by x collate "C"), '{}') into v_bcc from jsonb_array_elements_text(v_plan -> 'bcc') x;

  if exists (select 1 from unnest(v_bcc) b where b in (select email_owner_addresses())) then
    raise exception 'refused: an owner address is in Bcc';
  end if;
  if exists (select 1 from unnest(v_to || v_bcc) a join blocked_address_hashes h on h.hash = address_hash(a)) then
    raise exception 'refused: an address on the envelope is on blocked_address_hashes';
  end if;
  if exists (select 1 from unnest(v_to) a where a = any (v_bcc)) then
    raise exception 'refused: an address is on To and in Bcc';
  end if;

  insert into email_sends (event_key, recipient, rendered_sha)
  select p_event_key, a, p_rendered_sha from unnest(v_to || v_bcc) a;

  v_md5 := md5(array_to_string(v_to, ',') || '|' || array_to_string(v_bcc, ','));

  -- No address in either audit row: the rows in email_sends carry them, under RLS.
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'email_claim_broadcast', 'email_sends', p_event_key,
          jsonb_build_object('event_key', p_event_key, 'rendered_sha', p_rendered_sha,
                             'to', cardinality(v_to), 'bcc', v_n,
                             'p', v_plan -> 'p', 'h', v_plan -> 'h', 'o', v_plan -> 'o',
                             't', v_plan -> 't', 'x', v_plan -> 'x',
                             'envelope_md5', v_md5, 'omitted_owners', to_jsonb(v_omit),
                             'claim_id', v_claim));
  foreach v_code in array v_omit loop
    insert into audit_log (actor, action, target_table, target_id, after, note)
    values (p_actor, 'broadcast_owner_omitted', 'owners', v_code,
            jsonb_build_object('event_key', p_event_key),
            'no address on the owners table: left off To for this one send by an explicit override');
  end loop;

  return jsonb_build_object('event_key', p_event_key, 'claimed', cardinality(v_to) + v_n,
                            'to', cardinality(v_to), 'bcc', v_n, 'envelope_md5', v_md5,
                            'omitted_owners', to_jsonb(v_omit), 'claim_id', v_claim);
end $$;

revoke execute on function admin_email_claim_broadcast(text,text,text[],int,int,text) from public, anon;
grant execute on function admin_email_claim_broadcast(text,text,text[],int,int,text) to authenticated;
