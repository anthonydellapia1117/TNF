-- The public /players detail level: stored in config (public-readable pool
-- constant), flipped only by the admin through the audited RPC.
begin;

-- Anon reads the mode (the public page needs it) and nothing new leaks.
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare
  v text;
begin
  select players_detail into v from config;
  if v <> 'full' then
    raise exception 'TEST FAILURE: default players_detail should be full, got %', v;
  end if;
end $$;
reset role;

-- Anon cannot flip it: the RPC is not granted to anon at all.
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform admin_set_players_detail('lean', 'anon');
    raise exception 'TEST FAILURE: anon flipped the players detail mode';
  exception
    when insufficient_privilege then null;
  end;
end $$;
reset role;

-- A non-admin authenticated caller is stopped by assert_admin.
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"stranger@example.com"}', true);
do $$
begin
  begin
    perform admin_set_players_detail('lean', 'stranger');
    raise exception 'TEST FAILURE: non-admin flipped the players detail mode';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;
reset role;

-- The admin flips it both ways, audited; junk values are refused.
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  v text;
  n int;
begin
  perform admin_set_players_detail('lean', 'test');
  select players_detail into v from config;
  if v <> 'lean' then
    raise exception 'TEST FAILURE: mode did not flip to lean';
  end if;
  select count(*) into n from audit_log where action = 'set_players_detail';
  if n < 1 then
    raise exception 'TEST FAILURE: flip was not audited';
  end if;

  begin
    perform admin_set_players_detail('naked', 'test');
    raise exception 'TEST FAILURE: junk mode accepted';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;

  perform admin_set_players_detail('full', 'test');
  select players_detail into v from config;
  if v <> 'full' then
    raise exception 'TEST FAILURE: mode did not flip back to full';
  end if;
end $$;

rollback;
