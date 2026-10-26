#!/usr/bin/env bash
# Two-session regression checks for migration 39 (review of PR 31).
#
# 1. A correction and an owner-held payment for the same participant,
#    committing together, must leave his block assigned when he ends up paid
#    in full. Without the participant lock in admin_promote_if_paid and
#    admin_demote_if_unpaid, each side judges the other's uncommitted state and
#    the block is left reserved, paid in full.
# 2. A correction and the score that makes his block a winner, committing
#    together, must never leave an owed payout on a reserved block. Without
#    the row lock admin_score_game takes on the winning block, scoring reads
#    the block as assigned from its snapshot while the correction demotes it.
#
# The SQL suites run in one session inside one rolled-back transaction, so they
# check that the lock is taken (tests/sql/27); this script checks the races. It
# rebuilds the local test database first.
#
#   scripts/db/race-demote.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$REPO_ROOT/scripts/db/test-db.sh" >/dev/null

export PGHOST="${TNF_PGDIR:-/tmp/pg}" PGUSER=postgres
DB=tnf_test
CLAIM="select set_config('request.jwt.claims', '{\"email\":\"anthonydellapia@gmail.com\"}', true);"
q() { psql -q -d "$DB" -v ON_ERROR_STOP=1 -At "$@"; }

# One participant, one block, RM cash, assigned. $1: a game number to make
# that block its winner for away/home scores kept in race_fx, or 0 for none.
setup() {
  q >/dev/null <<SQL
set client_min_messages = warning;
begin; $CLAIM
create table if not exists race_fx (pid uuid, block int, orig uuid, game uuid, away int, home int);
truncate race_fx;
do \$\$ declare v_p uuid; v_b int; v_g uuid; v_away int; v_home int; begin
  select min(block_number) into v_b from blocks where status = 'available';
  insert into participants (full_name, owner_group, blocks_requested) values ('Race', 'RM', 1) returning id into v_p;
  perform admin_reserve_blocks(array[v_b], v_p, 'admin', 'race', 'race');
  perform admin_record_payment(v_p, 50000, 'cash', '2026-09-04', null, 'race original', null, null, 'race', 'RM');
  if $1 > 0 then
    select id into v_g from games where game_no = $1;
    update games set row_digits = array[0,1,2,3,4,5,6,7,8,9], col_digits = array[0,1,2,3,4,5,6,7,8,9],
                     digits_assigned_at = now() - interval '2 minutes', digits_published_at = now() - interval '1 minute'
     where id = v_g;
    -- AWAY selects the row, HOME the column (CLAUDE.md, grid orientation).
    v_away := (v_b - 1) / 10;
    v_home := (v_b - 1) % 10;
    if winning_block(array[0,1,2,3,4,5,6,7,8,9], array[0,1,2,3,4,5,6,7,8,9], v_home, v_away) <> v_b then
      raise exception 'race setup: scores % at % do not hit block %', v_away, v_home, v_b;
    end if;
  end if;
  insert into race_fx select v_p, v_b, (select id from payments where participant_id = v_p), v_g, v_away, v_home;
end \$\$;
commit;
SQL
}

CORR="select admin_record_payment((select pid from race_fx), -50000, 'correction', '2026-10-26', null, 'race correction', null, (select orig from race_fx), 'race-a', null);"
PAY="select admin_record_payment((select pid from race_fx), 50000, 'cash', '2026-10-26', null, 'race payment', null, null, 'race-b', 'RM');"
SCORE="select admin_score_game((select game from race_fx), 'halftime', (select away from race_fx), (select home from race_fx), 'race-s');"

# $1 game number for setup; $2 runs first and holds its transaction open;
# $3 commits while it waits. A refused statement is an outcome, not an error.
race() {
  setup "$1"
  q -c "begin; $CLAIM $2 select pg_sleep(3); commit;" >/dev/null 2>&1 &
  local first=$!
  sleep 1
  q -c "begin; $CLAIM $3 commit;" >/dev/null 2>&1 || true
  wait "$first" || true
  q -c "select b.status || ' payouts=' || (select count(*) from payouts p where p.block_number = r.block and p.status <> 'void')
               || ' corrections=' || (select count(*) from payments c where c.corrects_payment_id = r.orig)
          from race_fx r join blocks b on b.block_number = r.block;"
}

status=0
check() { # $1 name, $2 expected, $3 game, $4 first, $5 second
  local got
  got="$(race "$3" "$4" "$5")"
  if [ "$got" = "$2" ]; then
    echo "PASS race, $1: $got"
  else
    echo "FAIL race, $1: got $got, expected $2"
    status=1
  fi
}
check "correction first, payment races in" "assigned payouts=0 corrections=1" 0 "$CORR" "$PAY"
check "payment first, correction races in" "assigned payouts=0 corrections=1" 0 "$PAY" "$CORR"
check "correction first, winning score races in" "reserved payouts=0 corrections=1" 1 "$CORR" "$SCORE"
check "winning score first, correction races in" "assigned payouts=1 corrections=0" 2 "$SCORE" "$CORR"
exit $status
