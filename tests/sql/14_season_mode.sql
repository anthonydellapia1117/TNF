-- Season mode, and the v_pot money gate that ships with it.
--
-- The important assertions here are the ones about what an ANONYMOUS caller
-- gets from v_pot. v_pot is a definer view readable by anon, so a value left
-- in it is public whether or not any page renders it. Money in and money
-- owed are both admin-only, in either mode (migration 16). Block counts stay
-- visible on purpose — /blocks is the availability board and computes "51
-- open" from them, and the per-cell statuses are public anyway.
begin;

-- The local harness stub grants the client roles SELECT only; real Supabase
-- grants writes to anon/authenticated and leans entirely on RLS. Grant that
-- here — inside this transaction, rolled back with everything else — so the
-- flip below runs as the role PostgREST actually uses and the
-- admin_write_config / admin_all_audit policies are genuinely exercised
-- rather than bypassed by writing as the table owner.
grant update on config to authenticated;
grant insert on audit_log to authenticated;
grant usage, select on sequence audit_log_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Default: OFF. Nothing about the public site changes until it is flipped.
-- ---------------------------------------------------------------------------
do $$
declare v boolean;
begin
  select season_mode into v from config where id = 1;
  if v is distinct from false then
    raise exception 'TEST FAILURE: season_mode must default to false, got %',
      coalesce(v::text, 'null');
  end if;
end $$;

-- Anon can READ the flag: every public page needs it to decide what to show.
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare v boolean;
begin
  select season_mode into v from config where id = 1;
  if v is distinct from false then
    raise exception 'TEST FAILURE: anon cannot read season_mode (got %)',
      coalesce(v::text, 'null');
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- SEASON MODE OFF — anon sees collected, never owed.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare r record;
begin
  select * into r from v_pot;

  -- Owed is never public. Not before the season, not during it.
  if r.due_cents is not null then
    raise exception 'TEST FAILURE: anon can see due_cents (%) with season mode OFF', r.due_cents;
  end if;
  if r.owed_out_cents is not null then
    raise exception 'TEST FAILURE: anon can see owed_out_cents (%) with season mode OFF', r.owed_out_cents;
  end if;

  -- Money in is admin-only too, since migration 16: the viewer dashboard
  -- has no Collected card in either mode, so nothing public reads it.
  if r.collected_cents is not null then
    raise exception 'TEST FAILURE: anon can see collected_cents (%) with season mode OFF', r.collected_cents;
  end if;

  -- Block counts and paid-out history stay public in both modes.
  if r.available is null or r.committed_blocks is null then
    raise exception 'TEST FAILURE: anon lost the public block counts';
  end if;
  -- paid_out_cents joined the admin-only set in migration 21: with the
  -- public payout rows still visible, anon could subtract it to recover the
  -- owed liability.
  if r.paid_out_cents is not null then
    raise exception 'TEST FAILURE: anon can see paid_out_cents (%)', r.paid_out_cents;
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- The ADMIN sees everything, season mode off. is_admin() reads
-- request.jwt.claims — a session GUC that SECURITY DEFINER does not touch —
-- so the case expressions inside the definer view still see the real caller.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare r record;
begin
  select * into r from v_pot;
  if r.due_cents is null then
    raise exception 'TEST FAILURE: admin cannot see due_cents';
  end if;
  if r.owed_out_cents is null then
    raise exception 'TEST FAILURE: admin cannot see owed_out_cents';
  end if;
  if r.collected_cents is null then
    raise exception 'TEST FAILURE: admin cannot see collected_cents';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Anon cannot flip the switch: the RPC is not granted to anon at all.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform admin_set_season_mode(true, 'anon');
    raise exception 'TEST FAILURE: anon turned season mode on';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A signed-in non-admin is refused by assert_admin() even though the
-- function IS granted to authenticated.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"someoneelse@example.com"}', true);
do $$
begin
  begin
    perform admin_set_season_mode(true, 'someoneelse@example.com');
    raise exception 'TEST FAILURE: a non-admin turned season mode on';
  exception
    when others then
      if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;
reset role;

-- Anon cannot reach around the RPC and write the column directly.
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    update config set season_mode = true where id = 1;
    if (select season_mode from config where id = 1) then
      raise exception 'TEST FAILURE: anon wrote season_mode directly';
    end if;
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Flip it ON as the admin, and audit the change.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
select admin_set_season_mode(true, 'anthonydellapia@gmail.com');
reset role;

do $$
declare v boolean; n int;
begin
  select season_mode into v from config where id = 1;
  if v is not true then
    raise exception 'TEST FAILURE: season mode did not turn on';
  end if;
  -- Audited, with the prior value, like every other write in this schema.
  select count(*) into n from audit_log
   where action = 'set_season_mode'
     and (before->>'season_mode') = 'false'
     and (after->>'season_mode') = 'true';
  if n <> 1 then
    raise exception 'TEST FAILURE: expected 1 audited season-mode flip, got %', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- SEASON MODE ON — anon now loses collected money too, and still no owed.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare r record;
begin
  select * into r from v_pot;
  if r.collected_cents is not null then
    raise exception 'TEST FAILURE: anon can see collected_cents (%) in season mode', r.collected_cents;
  end if;
  if r.due_cents is not null then
    raise exception 'TEST FAILURE: anon can see due_cents (%) in season mode', r.due_cents;
  end if;
  if r.owed_out_cents is not null then
    raise exception 'TEST FAILURE: anon can see owed_out_cents (%) in season mode', r.owed_out_cents;
  end if;
  -- The board still works: it needs to know which cells are free.
  if r.available is null or r.committed_blocks is null then
    raise exception 'TEST FAILURE: season mode broke the public block counts';
  end if;
end $$;
reset role;

-- Admin is unaffected by the flip — this is the whole point of gating
-- rather than deleting.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare r record;
begin
  select * into r from v_pot;
  if r.due_cents is null or r.collected_cents is null or r.owed_out_cents is null then
    raise exception 'TEST FAILURE: season mode hid money from the admin';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- due_cents still computes correctly for the admin after the rewrite: it is
-- the same arithmetic migration 12 established, comped blocks excluded.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare v_view bigint; v_expected bigint;
begin
  select due_cents into v_view from v_pot;
  select (select coalesce(sum(
            greatest(0,
              greatest(p.blocks_requested,
                (select count(*) from blocks b
                  where b.participant_id = p.id
                    and b.status in ('reserved','assigned')))
              - (select count(*) from blocks b
                  where b.participant_id = p.id
                    and b.status in ('reserved','assigned') and b.comped)
            )), 0) from participants p) * c.price_per_block_cents
    into v_expected from config c;
  if v_view is distinct from v_expected then
    raise exception 'TEST FAILURE: due_cents drifted in the rewrite: view % expected %',
      v_view, v_expected;
  end if;
end $$;
reset role;

-- Flip back off and confirm the audit trail records both directions.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
select admin_set_season_mode(false, 'anthonydellapia@gmail.com');
reset role;

do $$
declare n int;
begin
  select count(*) into n from audit_log where action = 'set_season_mode';
  if n <> 2 then
    raise exception 'TEST FAILURE: expected 2 audited flips, got %', n;
  end if;
  if (select season_mode from config where id = 1) then
    raise exception 'TEST FAILURE: season mode did not turn back off';
  end if;
end $$;

-- Null is rejected outright rather than silently becoming false.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);
do $$
begin
  begin
    perform admin_set_season_mode(null, 'anthonydellapia@gmail.com');
    raise exception 'TEST FAILURE: a null season_mode was accepted';
  exception
    when others then
      if sqlerrm not like '%must be true or false%' then raise; end if;
  end;
end $$;
reset role;

rollback;
