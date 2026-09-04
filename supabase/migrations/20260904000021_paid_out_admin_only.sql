-- Close the owed-to-winners leak, before the first game is scored.
--
-- v_pot.owed_out_cents is already admin-only (migration 15). But it was
-- reconstructible by arithmetic from two anon reads:
--
--     owed = SUM(v_public_payouts.amount_cents) - v_pot.paid_out_cents
--
-- v_public_payouts serves every non-void payout, paid and owed alike, and
-- carries no status column — so the sum is paid+owed, and subtracting the
-- public paid total leaves the liability exactly. The gate on the aggregate
-- was closing a door while the window was open.
--
-- The fix is on the paid_out_cents side, not the payouts side. Restricting
-- v_public_payouts to status='paid' would have closed it too, but at a real
-- cost: /winners builds its standings from that view, so a winner would
-- vanish from the public page between the whistle and Anthony settling them.
-- The winner moment is the product; it does not get to wait on a Venmo.
--
-- paid_out_cents is read by /admin only — the Paid out stat and the season
-- progress strip. No public page renders it. Gating it costs nothing and
-- leaves /winners with every payout row and every amount, exactly as now.
--
-- After this, anon still sees the winner history by name and amount, which
-- is public by design. What anon cannot do is total it against a paid figure
-- to recover the liability.
--
-- Nine columns, same order and names. One expression changes.

create or replace view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  case when is_admin() then
    (select coalesce(sum(amount_cents),0) from payments)
  end::bigint as collected_cents,
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
  -- Money out: ADMIN ONLY as of migration 21. Not because the figure is
  -- secret on its own — the individual payouts behind it are public on
  -- /winners — but because subtracting it from the public payout total
  -- recovers owed_out_cents, which is not.
  case when is_admin() then
    (select coalesce(sum(amount_cents),0) from payouts where status = 'paid')
  end::bigint as paid_out_cents,
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
