-- Season mode. Once the link goes out to the room on game-day mornings, the
-- public side has to read as a season in progress, not a pool being sold.
-- "51 blocks open" is a true number that tells the wrong story in front of
-- 133 people, so it is gated rather than deleted: admin still needs it.
--
-- Two separate things happen here, for two separate reasons.
--
-- 1. config.season_mode — an admin toggle, default OFF so nothing about
--    today's public site changes until Anthony flips it.
--
-- 2. v_pot stops handing a non-admin caller money it has no business
--    seeing. This is NOT cosmetic: v_pot is a definer view readable by
--    anon, and it was serving due_cents (every dollar still owed to the
--    pool) and owed_out_cents to anyone who opened devtools or curled the
--    REST endpoint, even though no page ever rendered them. Amounts owed
--    are never public — that rule does not wait for season mode, so those
--    two are gated on is_admin() alone. collected_cents is different: the
--    pre-season dashboard legitimately shows it, so it is gated on season
--    mode as well, and flipping the toggle removes it from the payload and
--    not merely from the pixels.
--
-- Block counts (available/reserved/assigned/held/committed_blocks) stay
-- open to everyone on purpose: the public board shows which cells are free
-- cell by cell, so the count is already derivable from v_public_blocks.
-- Gating it here would be theatre, not privacy. What season mode does with
-- those counts is stop *featuring* them, which is a UI job.

alter table config add column season_mode boolean not null default false;

comment on column config.season_mode is
  'When true the public side leads with the season — next game, grid, '
  'winners — and drops every sales surface: open counts, the claim CTA, '
  'the claim-by deadline, and collected money. Admin is unaffected.';

-- ---------------------------------------------------------------------------
-- The toggle. Same shape as admin_set_players_detail (migration 10).
-- ---------------------------------------------------------------------------

create or replace function admin_set_season_mode(p_on boolean, p_actor text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before boolean;
begin
  perform assert_admin();
  if p_on is null then
    raise exception 'season_mode must be true or false, not null';
  end if;
  select season_mode into v_before from config where id = 1;
  update config set season_mode = p_on where id = 1;
  insert into audit_log (actor, action, target_table, target_id, before, after)
  values (p_actor, 'set_season_mode', 'config', '1',
          jsonb_build_object('season_mode', v_before),
          jsonb_build_object('season_mode', p_on));
end $$;

do $$
begin
  execute 'revoke execute on function admin_set_season_mode(boolean,text) from public, anon';
  execute 'grant execute on function admin_set_season_mode(boolean,text) to authenticated';
end $$;

-- ---------------------------------------------------------------------------
-- v_pot: same nine columns, same order (create or replace can only append,
-- and this appends nothing). Only three expressions change.
--
-- v_pot stays definer and stays fully inlined from the base tables — a
-- security_invoker view nested in here would evaluate RLS as the session
-- user and return zeros. is_admin() reads request.jwt.claims, a session
-- GUC that SECURITY DEFINER does not touch, so it still sees the real
-- caller. Both branches are proven in tests/sql/14_season_mode.sql.
-- ---------------------------------------------------------------------------

create or replace view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  -- Money in: admin always; the public only before season mode.
  case when is_admin()
         or not (select season_mode from config where id = 1)
       then (select coalesce(sum(amount_cents),0) from payments)
  end::bigint as collected_cents,
  -- Amounts owed to the pool: admin only, season mode or not.
  case when is_admin() then
    (select
       (select coalesce(sum(
          greatest(
            0,
            greatest(
              p.blocks_requested,
              (select count(*) from blocks b
                where b.participant_id = p.id and b.status in ('reserved','assigned'))
            )
            - (select count(*) from blocks b
                where b.participant_id = p.id
                  and b.status in ('reserved','assigned') and b.comped)
          )), 0)
        from participants p) * c.price_per_block_cents
     from config c)
  end::bigint as due_cents,
  -- Paid out to winners: public history, same as the /winners page.
  (select coalesce(sum(amount_cents),0) from payouts where status = 'paid')::bigint as paid_out_cents,
  -- Owed to winners is liability: admin only.
  case when is_admin() then
    (select coalesce(sum(amount_cents),0) from payouts where status = 'owed')
  end::bigint as owed_out_cents,
  (select coalesce(sum(
     greatest(
       p.blocks_requested,
       (select count(*) from blocks b
         where b.participant_id = p.id and b.status in ('reserved','assigned'))
     )), 0)
   from participants p)::int as committed_blocks;
