-- Migration 42: the game-day pack leaves an owner with no address off To, on
-- the record (Anthony, 2026-11-20, Part M).
--
-- A broadcast refuses when an owner has no address, unless one send names that
-- owner in an explicit one-time override (--omit-owner). For a sent broadcast
-- the claim before the send audits it (admin_email_claim_broadcast, migrations
-- 37 and 41): it refuses unless the codes named are exactly the owners with no
-- address, then writes one broadcast_owner_omitted row per code. The game-day
-- pack is a draft Anthony sends himself, so it has no claim and nothing in
-- email_sends, and until now it could only refuse: with DN blank, TNF Game Day
-- would have written no draft at all.
--
-- admin_email_omit_owners is that same check and that same audit row, for a
-- game-day draft alone: no email_sends row, no other write. The routine calls
-- it once per game, right before --draft, and the command takes the same
-- --omit-owner. A retry for the same game writes nothing new.

create or replace function admin_email_omit_owners(
  p_event_key text,
  p_omit_owners text[],
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_omit text[];
  v_missing text[];
  v_code text;
  v_written text[] := '{}';
  v_game int;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if coalesce(p_event_key, '') !~ '^game_day_g\d{2}$' then
    raise exception 'not a game-day draft: %. A sent broadcast is audited by its claim (admin_email_claim_broadcast).', p_event_key;
  end if;
  v_game := substring(p_event_key from '\d{2}$')::int;
  if not exists (select 1 from games g where g.game_no = v_game) then
    raise exception 'no game %', v_game;
  end if;

  -- Same normalisation and same rule as the claim: the override names exactly
  -- the owners with no address.
  select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}')
    into v_omit
    from unnest(coalesce(p_omit_owners, '{}')) c
   where nullif(btrim(c), '') is not null;
  select coalesce(array_agg(o.code order by o.code), '{}')
    into v_missing
    from owners o
   where nullif(btrim(o.email), '') is null;
  if cardinality(v_omit) = 0 then
    raise exception 'nothing to omit: name the owners left off To, or pass no override';
  end if;
  if 'AVD' = any (v_omit) then
    raise exception 'refused: Anthony is never left off';
  end if;
  if v_omit is distinct from v_missing then
    raise exception 'refused: owners with no address are {%}; the override names {%}. Name exactly the owners left off, or set their addresses.',
      array_to_string(v_missing, ','), array_to_string(v_omit, ',');
  end if;

  -- One row per owner per game, whoever races it: a retry writes nothing new.
  perform pg_advisory_xact_lock(hashtext('admin_email_omit_owners:' || p_event_key));
  foreach v_code in array v_omit loop
    if not exists (select 1 from audit_log a
                    where a.action = 'broadcast_owner_omitted'
                      and a.target_table = 'owners'
                      and a.target_id = v_code
                      and a.after ->> 'event_key' = p_event_key) then
      insert into audit_log (actor, action, target_table, target_id, after, note)
      values (p_actor, 'broadcast_owner_omitted', 'owners', v_code,
              jsonb_build_object('event_key', p_event_key, 'draft', true),
              'no address on the owners table: left off To on this game-day draft by an explicit override');
      v_written := v_written || v_code;
    end if;
  end loop;

  return jsonb_build_object('event_key', p_event_key, 'omitted_owners', to_jsonb(v_omit),
                            'written', to_jsonb(v_written));
end $$;

revoke execute on function admin_email_omit_owners(text, text[], text) from public, anon;
grant execute on function admin_email_omit_owners(text, text[], text) to authenticated;
