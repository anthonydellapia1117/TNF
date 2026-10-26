-- The mirror of admin_promote_if_paid (Anthony, 2026-10-26, Part H2).
--
-- A payment row that turns out to be wrong is reversed with a correction row
-- (admin_record_payment, method 'correction'; it inherits the original's
-- collector, migration 32). The correction leaves the participant short, but
-- nothing moved his blocks back: admin_record_payment only ever promotes, and
-- no RPC took an assigned block back to reserved with its holder kept.
--
-- The paths that existed were each wrong for it:
--   admin_reserve_blocks   refuses anything that is not available.
--   admin_release_block    clears the holder, and writes "Released from <name>"
--                          into the block's notes: a false line once the block
--                          is reserved straight back to the same person.
--   admin_set_comped(false) on a block that was never comped: it would demote,
--                          but audit as uncomp_block.
--
-- So: one participant at a time, judged from v_participant_finance exactly as
-- promotion is. Short of what he owes (due > 0 and paid < due), every block of
-- his that is assigned and not comped goes back to reserved. Holder, display
-- name, comp flag, notes, method and ref are untouched. assigned_at is cleared,
-- because /block/[n] prints "assigned <date>" from it and a later promotion
-- stamps it again with coalesce; the old value is kept in the audit row.
-- A comped block owes nothing, so it stays assigned. Paid in full: nothing
-- moves and nothing is written. Partial payment demotes every non-comped
-- assigned block, the same all-or-nothing rule promotion uses.
--
-- It is called explicitly, in the same transaction as the corrections it
-- follows. admin_record_payment is not changed.

create or replace function admin_demote_if_unpaid(p_participant_id uuid, p_actor text) returns int
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_due bigint;
  v_paid bigint;
  v_before jsonb;
  v_count int := 0;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  select amount_due_cents, amount_paid_cents into v_due, v_paid
    from v_participant_finance where participant_id = p_participant_id;
  if v_due is null then
    raise exception 'participant % not found', p_participant_id;
  end if;
  if v_due > 0 and v_paid < v_due then
    select jsonb_agg(jsonb_build_object('block_number', b.block_number,
                                        'status', b.status,
                                        'assigned_at', b.assigned_at)
                     order by b.block_number)
      into v_before
      from blocks b
     where b.participant_id = p_participant_id
       and b.status = 'assigned' and not b.comped;
    update blocks
       set status = 'reserved', assigned_at = null
     where participant_id = p_participant_id
       and status = 'assigned' and not comped;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      insert into audit_log (actor, action, target_table, target_id, before, after, note)
      values (p_actor, 'demote_blocks', 'blocks', p_participant_id::text,
              jsonb_build_object('blocks', v_before),
              jsonb_build_object('demoted', v_count, 'due_cents', v_due, 'paid_cents', v_paid),
              'paid short of due: assigned back to reserved, holder and name kept');
    end if;
  end if;
  return v_count;
end $$;

revoke execute on function admin_demote_if_unpaid(uuid, text) from public, anon;
grant execute on function admin_demote_if_unpaid(uuid, text) to authenticated;
