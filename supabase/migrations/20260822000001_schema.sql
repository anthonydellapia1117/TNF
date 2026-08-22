-- TNF Block Pool — core schema (spec section 2.2).
-- Nothing derived is ever stored: no amount_paid, no cached counts, no totals.
-- Money and counts exist only in views (20260822000002_views.sql).

-- PARTICIPANTS
create table participants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  display_alias text,                  -- what Anthony calls them in the group chat
  email text,                          -- nullable; text and in-person signups are legitimate
  phone text,
  owner_group text not null default 'DIRECT'
    check (owner_group in ('AVD','MAP','RM','JPOD','EJD','NL','GD','DIRECT')),
  shared_group_id text,                -- e.g. 'SG-CUGINOS' for Virga + Fowler
  source text not null default 'email' check (source in ('email','text','in_person','import')),
  source_ref text,
  -- Committed block count before numbers are chosen (spec 6.3). Due is
  -- computed from greatest(blocks_requested, blocks_held) — never stored.
  blocks_requested int not null default 0 check (blocks_requested >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function touch_updated_at() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger participants_touch before update on participants
  for each row execute function touch_updated_at();

-- BLOCKS: exactly 100 rows, seeded 1-100, never inserted or deleted.
create table blocks (
  block_number int primary key check (block_number between 1 and 100),
  participant_id uuid references participants(id) on delete set null,
  status text not null default 'available'
    check (status in ('available','reserved','assigned','held')),
  assignment_method text check (assignment_method in ('requested','carryover','random','admin')),
  requested_ref text,                  -- source of the request
  assigned_at timestamptz,
  notes text
);

-- A block that belongs to nobody cannot be reserved or assigned.
alter table blocks add constraint blocks_owner_state check (
  (status in ('reserved','assigned') and participant_id is not null)
  or status in ('available','held')
);

insert into blocks (block_number)
select n from generate_series(1, 100) as n;

-- The 100-row set is closed. Every mutation is an UPDATE.
create or replace function blocks_fixed_set_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'blocks is a fixed set of 100 rows; % is not allowed', tg_op;
end $$;

create trigger blocks_fixed_set before insert or delete on blocks
  for each row execute function blocks_fixed_set_guard();

-- PAYMENTS: append-only. Corrections are new rows. Never edit, never delete.
create table payments (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id),   -- null = unmatched, quarantined
  amount_cents int not null,                          -- negative allowed for corrections
  method text not null check (method in ('venmo','cash','check','correction','comp')),
  paid_on date not null,
  venmo_txn_id text unique,                           -- UNIQUE is the dedupe, enforced here
  source_ref text,
  note text,
  corrects_payment_id uuid references payments(id),
  created_at timestamptz not null default now(),
  constraint correction_references_original
    check (method <> 'correction' or corrects_payment_id is not null)
);

create or replace function payments_append_only_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'payments is append-only; corrections are new rows (% blocked)', tg_op;
end $$;

create trigger payments_append_only before update or delete on payments
  for each row execute function payments_append_only_guard();

-- Digit permutations: every digit 0-9 exactly once.
create or replace function is_permutation(arr int[]) returns boolean
language sql immutable
set search_path = public, pg_temp
as $$
  select arr is not null
     and array_length(arr, 1) = 10
     and (select array_agg(d order by d) from unnest(arr) as d) = array[0,1,2,3,4,5,6,7,8,9]
$$;

-- The winning block: row index of the HOME last digit, column index of the
-- AWAY last digit (both 0-based), block = row*10 + col + 1. Spec section 3.
create or replace function winning_block(
  p_row_digits int[], p_col_digits int[], p_home_score int, p_away_score int
) returns int
language sql immutable
set search_path = public, pg_temp
as $$
  select (array_position(p_row_digits, p_home_score % 10) - 1) * 10
       + (array_position(p_col_digits, p_away_score % 10) - 1) + 1
$$;

-- GAMES
create table games (
  id uuid primary key default gen_random_uuid(),
  game_no int unique not null,          -- G01..G23
  week int not null,
  kickoff_at timestamptz,
  date_confirmed boolean not null default false,
  game_type text not null check (game_type in ('regular','holiday')),
  holiday_label text,                   -- 'Thanksgiving', 'Christmas Day', "New Year's Eve"
  home_team text not null,
  away_team text not null,
  network text,

  -- digits: each is a 10-element permutation of 0-9
  row_digits int[] check (row_digits is null or is_permutation(row_digits)),
  col_digits int[] check (col_digits is null or is_permutation(col_digits)),
  digit_seed text,
  digits_assigned_at timestamptz,
  digits_published_at timestamptz,

  -- scoring
  live_home int, live_away int, live_updated_at timestamptz,
  halftime_home int, halftime_away int, halftime_block int, halftime_scored_at timestamptz,
  final_home int, final_away int, final_block int, final_scored_at timestamptz,

  status text not null default 'scheduled'
    check (status in ('scheduled','digits_assigned','published','in_progress','halftime','final','void')),
  notes text
);

-- Digits are immutable once written (spec section 3). Re-randomizing happens
-- only for a game that has never had digits.
create or replace function games_digits_immutable_guard() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.digits_assigned_at is not null and (
       new.row_digits is distinct from old.row_digits
    or new.col_digits is distinct from old.col_digits
    or new.digit_seed is distinct from old.digit_seed
    or new.digits_assigned_at is distinct from old.digits_assigned_at
  ) then
    raise exception 'digits are immutable once assigned (game G%)', lpad(old.game_no::text, 2, '0');
  end if;
  return new;
end $$;

create trigger games_digits_immutable before update on games
  for each row execute function games_digits_immutable_guard();

-- PAYOUTS: one row per winning event.
create table payouts (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id),
  payout_type text not null check (payout_type in ('halftime','final')),
  block_number int not null references blocks(block_number),
  participant_id uuid references participants(id),
  amount_cents int not null,
  status text not null default 'owed' check (status in ('owed','paid','void')),
  paid_on date,
  method text,
  note text,
  created_at timestamptz not null default now(),
  unique (game_id, payout_type)
);

create table audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null, action text not null,
  target_table text not null, target_id text,
  before jsonb, after jsonb, note text
);

create table config (
  id int primary key default 1 check (id = 1),
  price_per_block_cents int not null default 50000,
  blocks_total int not null default 100,
  regular_halftime_cents int not null default 75000,
  regular_final_cents int not null default 100000,
  holiday_halftime_cents int not null default 75000,
  holiday_final_cents int not null default 150000,
  claim_deadline date not null default '2026-09-04',
  timezone text not null default 'America/New_York',
  season_status text not null default 'open'
);

insert into config (id) values (1);
