-- Bug fix: v_pot.due_cents read through v_participant_finance, which is
-- security_invoker — and an invoker view evaluates RLS as the SESSION user
-- even when nested inside a definer view. Anonymous visitors therefore got
-- due_cents = 0 (and the public "blocks open" figure collapsed to 100).
-- v_pot now computes due directly from the base tables, which the definer
-- view reads as its owner. The formula matches v_participant_finance
-- exactly; tests/sql/04 asserts the two agree and that anon sees it.

create or replace view v_pot as
select
  (select count(*) from blocks where status = 'available')::int as available,
  (select count(*) from blocks where status = 'reserved')::int  as reserved,
  (select count(*) from blocks where status = 'assigned')::int  as assigned,
  (select count(*) from blocks where status = 'held')::int      as held,
  (select coalesce(sum(amount_cents),0) from payments)::bigint  as collected_cents,
  (select
     (select coalesce(sum(
        greatest(
          p.blocks_requested,
          (select count(*) from blocks b
            where b.participant_id = p.id and b.status in ('reserved','assigned'))
        )), 0)
      from participants p) * c.price_per_block_cents
   from config c)::bigint as due_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'paid')::bigint as paid_out_cents,
  (select coalesce(sum(amount_cents),0) from payouts where status = 'owed')::bigint as owed_out_cents;
