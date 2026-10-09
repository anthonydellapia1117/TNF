-- Migration 36: a holder check-in says Paid only when the ledger backs it.
--
-- Anthony, 2026-10-08 (Part E4). Until now the holder check-in rendered
-- "Paid" for every assigned block, reading blocks.status. Status is not a
-- payment record: block 50 went out as Paid on Oct 7 to a holder who had never
-- paid Anthony (the row behind it was an owner's cash confirmation, since
-- reversed). Paid must come from the ledger.
--
-- email_holder_facts() now marks each committed block ledger_paid:
--   true  when the block is assigned and either comped (a comp is reconciled,
--         basis comp; Anthony 2026-10-08, Part F2), or the participant's
--         payment rows, corrections included, total at least the block price
--         for every assigned block of theirs that is not comped;
--   false otherwise, a reserved block included.
-- All or nothing per participant: two assigned blocks against one 500 row back
-- neither, because the ledger does not say which one it paid for.
--
-- The decision lives here, with the money; the renderer only reads it. The comp
-- flag itself still never reaches a context (it is admin-only): ledger_paid
-- says whether a block counts as paid, not why.

create or replace function email_holder_facts(p_recipient text)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  with reach as (
    select h.participant_id, h.via
      from email_holder_addresses() h
     where h.recipient = lower(btrim(p_recipient))
  ),
  cover as (
    -- What each reached participant's ledger covers: every payment row,
    -- corrections included, against the price of each assigned block that is
    -- not comped.
    select p.id as participant_id,
           coalesce((select sum(x.amount_cents) from payments x where x.participant_id = p.id), 0) as paid_cents,
           (select count(*) from blocks b2
             where b2.participant_id = p.id and b2.status = 'assigned' and not b2.comped) as owed_blocks
      from participants p
     where p.id in (select participant_id from reach)
  )
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'full_name', p.full_name,
               'display_alias', p.display_alias,
               'via', r.via,
               'owner_group', p.owner_group
             ) order by p.full_name, r.via)
        from reach r join participants p on p.id = r.participant_id), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'block_number', b.block_number,
               'status', b.status,
               'owner_group', p.owner_group,
               'owner_full_name', o.full_name,
               'ledger_paid', b.status = 'assigned'
                              and (b.comped
                                   or cv.paid_cents >= cv.owed_blocks
                                        * (select c.price_per_block_cents from config c where c.id = 1))
             ) order by b.block_number)
        from blocks b
        join participants p on p.id = b.participant_id
        join cover cv on cv.participant_id = b.participant_id
        left join owners o on o.code = p.owner_group
       where b.status in ('reserved', 'assigned')
         and b.participant_id in (select participant_id from reach)), '[]'::jsonb)
  )
$$;

revoke execute on function email_holder_facts(text) from public, anon, authenticated;
