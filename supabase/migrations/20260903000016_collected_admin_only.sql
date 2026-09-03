-- Collected money becomes admin-only, unconditionally.
--
-- Migration 15 gated v_pot.collected_cents on season_mode, because the
-- pre-season public dashboard legitimately rendered a "Collected" card. That
-- card is now gone from the viewer side outright — collection status is
-- administrative and lives on /admin — so no public surface reads the value
-- at any setting, and the season_mode condition was doing nothing except
-- leaving $3,500 in an anonymous REST payload.
--
-- Same rule as due_cents and owed_out_cents: money in and money owed are
-- admin numbers. What stays public is money OUT (paid_out_cents), which is
-- the same winner history the /winners page publishes name by name.
--
-- Block counts stay public and must: /blocks is the availability board, it
-- computes "51 open" from committed_blocks, and the per-cell statuses are
-- already public in v_public_blocks. That page is meant to show what is
-- open; the home page is not, which is where the number was removed.
--
-- Nine columns, same order. create or replace can only append, and this
-- appends nothing — one expression changes.

create or replace view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  -- Money in: admin only. No viewer surface reads this.
  case when is_admin() then
    (select coalesce(sum(amount_cents),0) from payments)
  end::bigint as collected_cents,
  -- Amounts owed to the pool: admin only.
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

comment on column config.season_mode is
  'When true the public side drops its remaining pre-season surfaces: the '
  'claim-by deadline card on the home page, the block-is-open nudge on '
  '/block/[n], the BLOCKS OPEN headline on the link-preview image, and two '
  'meta descriptions. Collection status, the committed count and the claim '
  'CTA are no longer viewer surfaces in either mode. The /blocks board keeps '
  'its availability counts in both modes — showing what is open is that '
  'page''s purpose.';
