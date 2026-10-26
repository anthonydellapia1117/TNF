#!/usr/bin/env bash
# Two-session regression check for migration 39 (review of PR 31): a correction
# and an owner-held payment for the same participant, committing together, must
# leave his block assigned when he ends up paid in full. Without the participant
# lock in admin_promote_if_paid and admin_demote_if_unpaid, each side judges the
# other's uncommitted state and the block is left reserved, paid in full.
#
# The SQL suites run in one session inside one rolled-back transaction, so they
# check that the lock is taken (tests/sql/27); this script checks the race. It
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

setup() {
  q >/dev/null <<SQL
set client_min_messages = warning;
begin; $CLAIM
create table if not exists race_fx (pid uuid, block int, orig uuid);
truncate race_fx;
do \$\$ declare v_p uuid; v_b int; begin
  select min(block_number) into v_b from blocks where status = 'available';
  insert into participants (full_name, owner_group, blocks_requested) values ('Race', 'RM', 1) returning id into v_p;
  perform admin_reserve_blocks(array[v_b], v_p, 'admin', 'race', 'race');
  perform admin_record_payment(v_p, 50000, 'cash', '2026-09-04', null, 'race original', null, null, 'race', 'RM');
  insert into race_fx select v_p, v_b, (select id from payments where participant_id = v_p);
end \$\$;
commit;
SQL
}

CORR="select admin_record_payment((select pid from race_fx), -50000, 'correction', '2026-10-26', null, 'race correction', null, (select orig from race_fx), 'race-a', null);"
PAY="select admin_record_payment((select pid from race_fx), 50000, 'cash', '2026-10-26', null, 'race payment', null, null, 'race-b', 'RM');"

# $1 runs first and holds its transaction open; $2 commits while it waits.
race() {
  setup
  q -c "begin; $CLAIM $1 select pg_sleep(3); commit;" >/dev/null &
  sleep 1
  q -c "begin; $CLAIM $2 commit;" >/dev/null
  wait
  q -c "select b.status from race_fx r join blocks b on b.block_number = r.block;"
}

status=0
check() { # $1 name, $2 first, $3 second
  local got
  got="$(race "$2" "$3")"
  if [ "$got" = "assigned" ]; then
    echo "PASS race, $1: assigned, paid in full"
  else
    echo "FAIL race, $1: block is $got though he is paid in full"
    status=1
  fi
}
check "correction first" "$CORR" "$PAY"
check "payment first" "$PAY" "$CORR"
exit $status
