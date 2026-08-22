-- Computed views (spec 2.3). These are the ONLY source of any derived figure.

-- Per-participant finance, computed. Due counts committed-but-unnumbered
-- blocks via blocks_requested (spec 6.3): greatest(requested, held) * price.
create view v_participant_finance as
select
  p.id as participant_id,
  count(b.block_number) filter (where b.status in ('reserved','assigned'))::int as blocks_held,
  count(b.block_number) filter (where b.status = 'assigned')::int as blocks_assigned,
  greatest(
    p.blocks_requested,
    count(b.block_number) filter (where b.status in ('reserved','assigned'))
  )::int * c.price_per_block_cents as amount_due_cents,
  coalesce((select sum(pay.amount_cents) from payments pay where pay.participant_id = p.id), 0)::bigint as amount_paid_cents
from participants p
left join blocks b on b.participant_id = p.id
cross join config c
group by p.id, p.blocks_requested, c.price_per_block_cents;

-- Pot
create view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  (select coalesce(sum(amount_cents),0) from payments)::bigint  as collected_cents,
  (select coalesce(sum(amount_due_cents),0) from v_participant_finance)::bigint as due_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'paid')::bigint as paid_out_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'owed')::bigint as owed_out_cents;

-- Public projection: names only, no contact or money. owner_group and the
-- opaque participant id feed the board's color-by-group toggle and the
-- personal block page; neither exposes contact or payment data.
create view v_public_blocks as
select b.block_number, b.status,
       coalesce(p.display_alias, p.full_name) as display_name,
       p.owner_group,
       b.participant_id
from blocks b left join participants p on p.id = b.participant_id;

-- Public games: digits stay invisible until published (acceptance 6);
-- digit_seed and admin notes never leave the database.
create view v_public_games as
select
  g.id, g.game_no, g.week, g.kickoff_at, g.date_confirmed, g.game_type,
  g.holiday_label, g.home_team, g.away_team, g.network,
  case when g.digits_published_at is not null then g.row_digits end as row_digits,
  case when g.digits_published_at is not null then g.col_digits end as col_digits,
  (g.digits_assigned_at is not null) as digits_assigned,
  g.digits_published_at,
  g.live_home, g.live_away, g.live_updated_at,
  g.halftime_home, g.halftime_away, g.halftime_block, g.halftime_scored_at,
  g.final_home, g.final_away, g.final_block, g.final_scored_at,
  g.status
from games g;

-- Public payouts: winner and amount only. Paid vs owed is admin-only
-- (spec 4.6), so status, paid_on, and method are not here.
create view v_public_payouts as
select
  po.id, po.game_id, po.payout_type, po.block_number, po.participant_id,
  coalesce(p.display_alias, p.full_name) as display_name,
  po.amount_cents, po.created_at
from payouts po
left join participants p on p.id = po.participant_id
where po.status <> 'void';
