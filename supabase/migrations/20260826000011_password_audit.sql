-- A password change is a security event and belongs in the audit trail:
-- who, when, and which surface it came from. No password material is ever
-- recorded — not the old one, not the new one, not a hash or a length.
create or replace function admin_log_password_change(p_actor text, p_surface text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();
  if p_surface is null or length(p_surface) > 64 then
    raise exception 'surface must be a short label';
  end if;
  insert into audit_log (actor, action, target_table, target_id, after, note)
  values (p_actor, 'change_password', 'auth.users', p_actor,
          jsonb_build_object('surface', p_surface),
          'admin password changed — no password material recorded');
end $$;

do $$
begin
  execute 'revoke execute on function admin_log_password_change(text,text) from public, anon';
  execute 'grant execute on function admin_log_password_change(text,text) to authenticated';
end $$;
