-- Digit gates, immutability, scoring gates, and the unassigned-winner rule
-- (spec section 3; section 7 rows 4-8 and 13).
begin;

-- The RPCs authorize via the JWT email, exactly as in production.
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

do $$
declare
  g2 uuid;
  g games;
  v_res jsonb;
  v_home int;
  v_away int;
begin
  -- Force the fixture state explicitly (rolled back at file end) so the
  -- test is independent of what the seed says about G02. The failure
  -- markers deliberately avoid the words the expected errors contain —
  -- otherwise an unexpected success gets swallowed by its own handler.
  select id into g2 from games where game_no = 2;
  update games set date_confirmed = false, kickoff_at = now() + interval '7 days' where id = g2;

  -- Gate: never assign when date_confirmed = false.
  begin
    perform admin_assign_digits(g2, 'test');
    raise exception 'TEST FAILURE: assign accepted a TBD date';
  exception
    when raise_exception then
      if sqlerrm not like '%unconfirmed%' then raise; end if;
  end;

  -- Gate: never assign after kickoff.
  update games set date_confirmed = true, kickoff_at = now() - interval '1 hour' where id = g2;
  begin
    perform admin_assign_digits(g2, 'test');
    raise exception 'TEST FAILURE: assign accepted a started game';
  exception
    when raise_exception then
      if sqlerrm not like '%kickoff%' then raise; end if;
  end;

  -- Gate: never score before digits are published (no digits at all yet).
  begin
    perform admin_score_game(g2, 'final', 14, 27, 'test');
    raise exception 'TEST FAILURE: scoring accepted with no digits';
  exception
    when raise_exception then
      if sqlerrm not like '%published%' then raise; end if;
  end;

  -- A confirmed future game assigns cleanly, and both arrays are permutations.
  update games set kickoff_at = now() + interval '7 days' where id = g2;
  g := admin_assign_digits(g2, 'test');
  if not is_permutation(g.row_digits) or not is_permutation(g.col_digits) then
    raise exception 'assigned digits are not permutations: % / %', g.row_digits, g.col_digits;
  end if;
  if g.status <> 'digits_assigned' or g.digit_seed is null then
    raise exception 'assignment state wrong';
  end if;

  -- Gate: never assign twice.
  begin
    perform admin_assign_digits(g2, 'test');
    raise exception 'digits re-assigned';
  exception
    when raise_exception then
      if sqlerrm not like '%already assigned%' then raise; end if;
  end;

  -- Digits are immutable at the database: even a direct update is refused.
  begin
    update games set row_digits = array[0,1,2,3,4,5,6,7,8,9] where id = g2;
    raise exception 'direct digit update was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%immutable%' then raise; end if;
  end;

  -- A repeated digit never passes the constraint (fresh game, no digits yet).
  begin
    update games set row_digits = array[1,1,2,3,4,5,6,7,8,9] where game_no = 3;
    raise exception 'non-permutation digits were accepted';
  exception
    when check_violation then null;
  end;

  -- Gate: still cannot score before PUBLISH even with digits assigned.
  begin
    perform admin_score_game(g2, 'halftime', 0, 0, 'test');
    raise exception 'scored between assign and publish';
  exception
    when raise_exception then
      if sqlerrm not like '%published%' then raise; end if;
  end;

  perform admin_publish_digits(g2, 'test');
  select * into g from games where id = g2;
  if g.digits_published_at is null or g.status <> 'published' then
    raise exception 'publish state wrong';
  end if;

  -- An unassigned winning block produces NO payout and raises a review flag.
  -- Force block 1 (available): away last digit = row_digits[1], home = col_digits[1].
  v_away := g.row_digits[1];
  v_home := g.col_digits[1];
  v_res := admin_score_game(g2, 'halftime', v_away, v_home, 'test');
  if (v_res ->> 'block')::int <> 1 or (v_res ->> 'payout_created')::boolean
     or not (v_res ->> 'review')::boolean then
    raise exception 'unassigned winner mishandled: %', v_res;
  end if;
  if exists (select 1 from payouts where game_id = g2) then
    raise exception 'payout created for an unassigned block';
  end if;
  if not exists (select 1 from audit_log where action = 'review_flag' and target_id = g2::text) then
    raise exception 'no review flag raised';
  end if;
  select * into g from games where id = g2;
  if g.halftime_block <> 1 or g.halftime_home is null then
    raise exception 'score was not recorded on review path';
  end if;

  -- An Assigned winning block pays. Force block 15 (Nicco Esgro, assigned):
  -- row index 1 → row_digits[2] (away), col index 4 → col_digits[5] (home).
  v_away := g.row_digits[2];
  v_home := g.col_digits[5];
  v_res := admin_score_game(g2, 'final', v_away, v_home, 'test');
  if (v_res ->> 'block')::int <> 15 or not (v_res ->> 'payout_created')::boolean then
    raise exception 'assigned winner mishandled: %', v_res;
  end if;
  if not exists (
    select 1 from payouts po
      join participants p on p.id = po.participant_id
     where po.game_id = g2 and po.payout_type = 'final' and po.block_number = 15
       and po.status = 'owed' and po.amount_cents = 100000
       and p.full_name = 'Nicco Esgro'
  ) then
    raise exception 'final payout row wrong';
  end if;

  -- Reserved is never treated as Assigned for payout (section 7 row 4):
  -- block 34 (Stephen Tomiselli) is reserved. Force block 34: row index 3 →
  -- row_digits[4] (away), col index 3 → col_digits[4] (home). Re-score of the owed final.
  v_away := g.row_digits[4];
  v_home := g.col_digits[4];
  v_res := admin_score_game(g2, 'final', v_away, v_home, 'test');
  if (v_res ->> 'block')::int <> 34 or (v_res ->> 'payout_created')::boolean then
    raise exception 'reserved block was paid: %', v_res;
  end if;
  if exists (select 1 from payouts where game_id = g2 and payout_type = 'final' and status = 'owed') then
    raise exception 'owed payout survived a re-score onto a reserved block';
  end if;

  -- D7: a corrected score recomputes the winning block, winner, and payout
  -- row — a payout can never drift from its game. Promote Jr/Diz (full
  -- payment) so blocks 36/38 are assigned, then correct the final onto
  -- block 36: the single payout row for (game, final) must now carry the
  -- new block and winner, back at owed.
  perform admin_record_payment(
    (select id from participants where full_name = 'Jr/Diz'),
    100000, 'cash', current_date, null, null, 'D7 test', null, 'test');
  if (select count(*) from blocks b
        join participants p on p.id = b.participant_id
       where p.full_name = 'Jr/Diz' and b.status = 'assigned') <> 2 then
    raise exception 'Jr/Diz promotion did not assign both blocks';
  end if;
  -- Block 36 = row index 3, col index 5. AWAY on the row axis, HOME on the
  -- column axis: away = row_digits[4], home = col_digits[6].
  v_away := g.row_digits[4];
  v_home := g.col_digits[6];
  v_res := admin_score_game(g2, 'final', v_away, v_home, 'test');
  if (v_res ->> 'block')::int <> 36 or not (v_res ->> 'payout_created')::boolean then
    raise exception 'corrected score did not recompute: %', v_res;
  end if;
  if (select count(*) from payouts where game_id = g2 and payout_type = 'final') <> 1 then
    raise exception 'score correction left more than one final payout row';
  end if;
  if not exists (
    select 1 from payouts po
      join participants p on p.id = po.participant_id
     where po.game_id = g2 and po.payout_type = 'final'
       and po.block_number = 36 and po.status = 'owed'
       and po.amount_cents = 100000 and p.full_name = 'Jr/Diz'
  ) then
    raise exception 'payout row did not recompute to the corrected winner';
  end if;
  if (select final_block from games where id = g2) <> 36 then
    raise exception 'game final_block did not recompute';
  end if;

  -- The invariant held through every mutation above.
  if (select available + reserved + assigned + held from v_pot) <> 100 then
    raise exception 'block invariant broken during scoring';
  end if;
end $$;

-- The scoring RPC never runs for a non-admin.
select set_config('request.jwt.claims', '{"email":"someone-else@example.com"}', true);
do $$
begin
  begin
    perform admin_score_game((select id from games where game_no = 2), 'final', 1, 2, 'test');
    raise exception 'non-admin was allowed to score';
  exception
    when raise_exception then
      if sqlerrm not like '%not authorized%' then raise; end if;
  end;
end $$;

rollback;
