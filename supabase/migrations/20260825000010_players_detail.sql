-- Public /players detail level: FULL now (share with the team), LEAN before
-- Week 1 — flipped from admin with no deploy. Lives in config, which is
-- public-readable by design (pool constants only; the mode is not secret).
alter table config add column players_detail text not null default 'full'
  check (players_detail in ('full', 'lean'));

create or replace function admin_set_players_detail(p_mode text, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();
  if p_mode not in ('full', 'lean') then
    raise exception 'players detail must be full or lean';
  end if;
  update config set players_detail = p_mode where id = 1;
  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'set_players_detail', 'config', '1',
          jsonb_build_object('mode', p_mode));
end $$;

do $$
begin
  execute 'revoke execute on function admin_set_players_detail(text,text) from public, anon';
  execute 'grant execute on function admin_set_players_detail(text,text) to authenticated';
end $$;
