-- DIRECT retires; AVD absorbs it.
--
-- DIRECT was the catch-all for "came to Anthony with no intermediary." But
-- that IS Anthony's book, and every co-runner's book already reads as their
-- own code (MAP, RM, JPOD, EJD, NL, GD). Anthony's should read the same, so
-- the seventeen DIRECT participants become AVD and the value retires.
--
-- Order matters: migrate the rows first, then tighten the constraint behind
-- them. Doing it the other way round fails on the existing DIRECT rows.
--
-- History is NOT rewritten. audit_log rows whose before/after payloads say
-- DIRECT keep saying DIRECT — that is what the ledger is for, and the
-- constraint has never applied to jsonb payloads. The two participant notes
-- that explain a DIRECT decision get an appended line rather than an edit,
-- per the never-delete rule.

-- 1. Move every DIRECT participant to AVD, one audit row each.
do $$
declare
  r record;
begin
  for r in select id, owner_group from participants where owner_group = 'DIRECT' loop
    update participants set owner_group = 'AVD' where id = r.id;
    insert into audit_log (actor, action, target_table, target_id, before, after, note)
    values ('migration:20260828000013', 'set_owner_group', 'participants', r.id::text,
            jsonb_build_object('owner_group', 'DIRECT'),
            jsonb_build_object('owner_group', 'AVD'),
            'DIRECT retired — it was Anthony''s own book under a generic name; AVD is the same book under his code.');
  end loop;
end $$;

-- 2. Explain the rename where a note argued for DIRECT specifically.
update participants
   set notes = notes || ' [2026-08-28: the DIRECT group was retired and folded into AVD — '
             || 'same book, Anthony''s own, now under his code. The reasoning above still stands.]'
 where notes like '%Group DIRECT%';

-- 3. Retire the value: new default, tightened constraint.
alter table participants alter column owner_group set default 'AVD';
alter table participants drop constraint participants_owner_group_check;
alter table participants add constraint participants_owner_group_check
  check (owner_group in ('AVD','MAP','RM','JPOD','EJD','NL','GD'));

-- 4. The RPC fallback pointed at DIRECT for a blank group; point it at AVD.
-- Copied verbatim from migration 4 with that one value changed — nothing
-- else about this function's behaviour moves.
create or replace function admin_upsert_participant(
  p_id uuid,                       -- null = create
  p_full_name text,
  p_display_alias text,
  p_email text,
  p_phone text,
  p_owner_group text,
  p_shared_group_id text,
  p_source text,
  p_source_ref text,
  p_blocks_requested int,
  p_notes text,
  p_actor text
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_before jsonb;
begin
  perform assert_admin();
  if v_id is null then
    insert into participants (full_name, display_alias, email, phone, owner_group,
                              shared_group_id, source, source_ref, blocks_requested, notes)
    values (p_full_name, nullif(p_display_alias, ''), nullif(p_email, ''), nullif(p_phone, ''),
            coalesce(nullif(p_owner_group, ''), 'AVD'), nullif(p_shared_group_id, ''),
            coalesce(nullif(p_source, ''), 'email'), nullif(p_source_ref, ''),
            coalesce(p_blocks_requested, 0), nullif(p_notes, ''))
    returning id into v_id;
    insert into audit_log (actor, action, target_table, target_id, after)
    values (p_actor, 'create_participant', 'participants', v_id::text,
            jsonb_build_object('full_name', p_full_name, 'alias', p_display_alias));
  else
    select to_jsonb(p) into v_before from participants p where p.id = v_id;
    if v_before is null then
      raise exception 'participant % not found', v_id;
    end if;
    update participants set
      full_name = p_full_name,
      display_alias = nullif(p_display_alias, ''),
      email = nullif(p_email, ''),
      phone = nullif(p_phone, ''),
      owner_group = coalesce(nullif(p_owner_group, ''), 'AVD'),
      shared_group_id = nullif(p_shared_group_id, ''),
      source = coalesce(nullif(p_source, ''), 'email'),
      source_ref = nullif(p_source_ref, ''),
      blocks_requested = coalesce(p_blocks_requested, 0),
      notes = nullif(p_notes, '')
    where id = v_id;
    insert into audit_log (actor, action, target_table, target_id, before, after)
    values (p_actor, 'update_participant', 'participants', v_id::text, v_before,
            (select to_jsonb(p) from participants p where p.id = v_id));
  end if;
  return v_id;
end $$;
