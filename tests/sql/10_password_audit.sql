-- A password change writes an audit row: actor, timestamp, surface — and
-- never any password material.
begin;

-- Anon cannot call it at all (not granted).
set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
begin
  begin
    perform admin_log_password_change('anon', 'admin/account');
    raise exception 'TEST FAILURE: anon logged a password change';
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
    perform admin_log_password_change('stranger@example.com', 'admin/account');
    raise exception 'TEST FAILURE: non-admin logged a password change';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;
reset role;

-- The admin writes exactly one row, with the surface and no secrets.
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
do $$
declare
  r audit_log;
  n int;
begin
  perform admin_log_password_change('anthonydellapia@gmail.com', 'admin/account');
  select count(*) into n from audit_log where action = 'change_password';
  if n <> 1 then
    raise exception 'TEST FAILURE: expected 1 change_password row, got %', n;
  end if;
  select * into r from audit_log where action = 'change_password';

  if r.actor <> 'anthonydellapia@gmail.com' then
    raise exception 'TEST FAILURE: actor not recorded, got %', r.actor;
  end if;
  if r.at is null then
    raise exception 'TEST FAILURE: timestamp not recorded';
  end if;
  if r.after ->> 'surface' <> 'admin/account' then
    raise exception 'TEST FAILURE: surface not recorded, got %', r.after ->> 'surface';
  end if;

  -- No password material: the payload carries exactly one key, the surface,
  -- and nothing was captured as a before-image.
  if (select array_agg(k order by k) from jsonb_object_keys(r.after) k)
       <> array['surface'] then
    raise exception 'TEST FAILURE: unexpected keys in audit payload: %', r.after;
  end if;
  if r.before is not null then
    raise exception 'TEST FAILURE: audit row captured a before-image: %', r.before;
  end if;

  -- A junk surface is refused.
  begin
    perform admin_log_password_change('anthonydellapia@gmail.com', repeat('x', 200));
    raise exception 'TEST FAILURE: oversized surface accepted';
  exception
    when others then
      if sqlerrm like '%TEST FAILURE%' then raise; end if;
  end;
end $$;

-- Structural guarantee: the function cannot receive password material —
-- its only inputs are the actor and a short surface label.
do $$
declare
  v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_log_password_change';
  if v_args <> 'p_actor text, p_surface text' then
    raise exception 'TEST FAILURE: unexpected signature: %', v_args;
  end if;
end $$;

rollback;
