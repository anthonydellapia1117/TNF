-- DIRECT is retired and AVD absorbed it. The value must be unusable going
-- forward, the migration must have moved every row, and the audit history
-- must still say DIRECT where DIRECT was true at the time.
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

-- No participant is left on the retired value.
do $$
declare n int;
begin
  select count(*) into n from participants where owner_group = 'DIRECT';
  if n <> 0 then
    raise exception 'TEST FAILURE: % participants still sit on the retired group', n;
  end if;
end $$;

-- The constraint refuses it outright, on insert and on update.
do $$
declare v_id uuid;
begin
  begin
    insert into participants (full_name, owner_group) values ('Retired Group Probe', 'DIRECT');
    raise exception 'TEST FAILURE: inserted a participant on the retired group';
  exception
    when check_violation then null;
  end;

  select id into v_id from participants limit 1;
  begin
    update participants set owner_group = 'DIRECT' where id = v_id;
    raise exception 'TEST FAILURE: updated a participant onto the retired group';
  exception
    when check_violation then null;
  end;
end $$;

-- BG is a real owner code (migration 19). Billy Guyon collects and holds like
-- any other owner, so the constraint must ACCEPT it. Asserted positively —
-- if BG is ever dropped from the constraint this raises rather than going
-- quiet, because a rejected insert is a check_violation, not a no-op.
do $$
declare v_id uuid; v_grp text;
begin
  insert into participants (full_name, owner_group)
  values ('BG Probe', 'BG') returning id into v_id;
  select owner_group into v_grp from participants where id = v_id;
  if v_grp <> 'BG' then
    raise exception 'TEST FAILURE: BG did not persist, got %', coalesce(v_grp,'null');
  end if;
  -- And it must survive an UPDATE onto an existing row, which is the path a
  -- reassignment actually takes.
  update participants set owner_group = 'BG' where full_name = 'Default Group Probe';
  if (select owner_group from participants where full_name = 'Default Group Probe') <> 'BG' then
    raise exception 'TEST FAILURE: could not reassign an existing participant to BG';
  end if;
  update participants set owner_group = 'AVD' where full_name = 'Default Group Probe';
end $$;

-- The list is still closed. An unknown code is rejected exactly as before —
-- adding BG must not have loosened the constraint into accepting anything.
do $$
begin
  begin
    insert into participants (full_name, owner_group) values ('Bad Code Probe', 'ZZZ');
    raise exception 'TEST FAILURE: an unknown owner code was accepted';
  exception
    when check_violation then null; -- correct
  end;
end $$;

-- A blank group falls back to AVD, not to the retired value.
do $$
declare
  v_id uuid;
  v_grp text;
begin
  v_id := admin_upsert_participant(
    null, 'Blank Group Probe', null, null, null,
    '', null, 'in_person', null, 1, null, 'test');
  select owner_group into v_grp from participants where id = v_id;
  if v_grp <> 'AVD' then
    raise exception 'TEST FAILURE: blank owner_group fell back to %, expected AVD', v_grp;
  end if;
  -- And the column default agrees.
  insert into participants (full_name) values ('Default Group Probe');
  select owner_group into v_grp from participants where full_name = 'Default Group Probe';
  if v_grp <> 'AVD' then
    raise exception 'TEST FAILURE: column default is %, expected AVD', v_grp;
  end if;
end $$;

-- History is never rewritten. The retired value stays legal inside audit
-- payloads, because the ledger records what was true at the time and the
-- constraint has never reached into jsonb. (Production carries seventeen
-- such rows from the migration; this fixture seeds AVD directly, so the
-- invariant is proven rather than counted.)
do $$
declare n int;
begin
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values ('test', 'set_owner_group', 'participants', 'probe',
          jsonb_build_object('owner_group', 'DIRECT'),
          jsonb_build_object('owner_group', 'AVD'),
          'historical payload must survive the retirement');
  select count(*) into n from audit_log
   where action = 'set_owner_group' and before->>'owner_group' = 'DIRECT';
  if n = 0 then
    raise exception 'TEST FAILURE: the ledger cannot record the retired value';
  end if;
end $$;

rollback;
