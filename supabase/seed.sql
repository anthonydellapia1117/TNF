-- Seed data (spec section 6). Names are stored verbatim, case preserved.
-- The 05_SCHEDULE_2026_TNF.csv file is not in the repo, so per spec 6.2 the
-- 22 games after G01 carry placeholder matchups/dates with
-- date_confirmed = false for Anthony to fill in at /admin/games.
--
-- Spec 6.3's header says "26 blocks committed" but its table lists 27 rows
-- (13 with numbers, 14 without). The table is the source of truth; the app
-- computes every count live, so nothing depends on the summary figure.

-- ---------------------------------------------------------------------------
-- Games: 23 total — 15 regular, 8 holiday. Payouts sum to exactly $44,250.
-- ---------------------------------------------------------------------------

insert into games (game_no, week, kickoff_at, date_confirmed, game_type, holiday_label, away_team, home_team, network) values
  ( 1,  1, '2026-09-10 00:20:00+00', true,  'regular', null,            'New England Patriots',  'Seattle Seahawks',      'NBC'),
  ( 2,  2, '2026-09-18 00:15:00+00', false, 'regular', null,            'Buffalo Bills',         'Miami Dolphins',        'Prime Video'),
  ( 3,  3, '2026-09-25 00:15:00+00', false, 'regular', null,            'Philadelphia Eagles',   'New York Giants',       'Prime Video'),
  ( 4,  4, '2026-10-02 00:15:00+00', false, 'regular', null,            'Los Angeles Rams',      'San Francisco 49ers',   'Prime Video'),
  ( 5,  5, '2026-10-09 00:15:00+00', false, 'regular', null,            'Denver Broncos',        'Las Vegas Raiders',     'Prime Video'),
  ( 6,  6, '2026-10-16 00:15:00+00', false, 'regular', null,            'Pittsburgh Steelers',   'Cleveland Browns',      'Prime Video'),
  ( 7,  7, '2026-10-23 00:15:00+00', false, 'regular', null,            'Houston Texans',        'Jacksonville Jaguars',  'Prime Video'),
  ( 8,  8, '2026-10-30 00:15:00+00', false, 'regular', null,            'Minnesota Vikings',     'Green Bay Packers',     'Prime Video'),
  ( 9,  9, '2026-11-06 01:15:00+00', false, 'regular', null,            'New York Jets',         'Tennessee Titans',      'Prime Video'),
  (10, 10, '2026-11-13 01:15:00+00', false, 'regular', null,            'Atlanta Falcons',       'New Orleans Saints',    'Prime Video'),
  (11, 11, '2026-11-20 01:15:00+00', false, 'regular', null,            'Chicago Bears',         'Carolina Panthers',     'Prime Video'),
  (12, 12, '2026-11-26 17:30:00+00', false, 'holiday', 'Thanksgiving',  'Kansas City Chiefs',    'Detroit Lions',         'FOX'),
  (13, 12, '2026-11-26 21:30:00+00', false, 'holiday', 'Thanksgiving',  'Dallas Cowboys',        'Washington Commanders', 'CBS'),
  (14, 12, '2026-11-27 01:20:00+00', false, 'holiday', 'Thanksgiving',  'Cincinnati Bengals',    'Baltimore Ravens',      'NBC'),
  (15, 13, '2026-12-04 01:15:00+00', false, 'regular', null,            'Los Angeles Chargers',  'Arizona Cardinals',     'Prime Video'),
  (16, 14, '2026-12-11 01:15:00+00', false, 'regular', null,            'Indianapolis Colts',    'Tampa Bay Buccaneers',  'Prime Video'),
  (17, 15, '2026-12-18 01:15:00+00', false, 'regular', null,            'Green Bay Packers',     'Chicago Bears',         'Prime Video'),
  (18, 16, '2026-12-25 01:15:00+00', false, 'holiday', 'Christmas Eve', 'Kansas City Chiefs',    'Denver Broncos',        'Netflix'),
  (19, 16, '2026-12-25 18:00:00+00', false, 'holiday', 'Christmas Day', 'Dallas Cowboys',        'Philadelphia Eagles',   'Netflix'),
  (20, 16, '2026-12-25 21:30:00+00', false, 'holiday', 'Christmas Day', 'Baltimore Ravens',      'Pittsburgh Steelers',   'Netflix'),
  (21, 16, '2026-12-26 01:15:00+00', false, 'holiday', 'Christmas Day', 'San Francisco 49ers',   'Los Angeles Rams',      'Netflix'),
  (22, 16, '2026-12-27 01:00:00+00', false, 'regular', null,            'Buffalo Bills',         'New England Patriots',  'NFL Network'),
  (23, 17, '2027-01-01 01:15:00+00', false, 'holiday', 'New Year''s Eve', 'Miami Dolphins',      'New York Jets',         'Prime Video');

-- ---------------------------------------------------------------------------
-- Participants: 25 people, 27 committed blocks (Jr/Diz and Anthony Astorga
-- each committed two). blocks_requested carries commitments with no number.
-- ---------------------------------------------------------------------------

insert into participants (full_name, display_alias, email, phone, owner_group, shared_group_id, source, source_ref, blocks_requested, notes) values
  ('Robert Gambino',    'Rob Gambino',       null,                              null, 'DIRECT', null,         'email', null, 1,
   'PAYMENT DISPUTED: a $500 Venmo from him exists on Aug 17 (txn 4665850241799398643) but its memo is a gas-pump emoji, and no second $500 exists. Reserved and unpaid until Anthony resolves.'),
  ('Konnor McGrorty',   'Gurt',              null,                              null, 'DIRECT', null,         'email', null, 1, null),
  ('Stephen Tomiselli', 'Stephen Tomiselli', null,                              null, 'DIRECT', null,         'email', null, 1, 'Carryover from 2025'),
  ('Marc Virga',        'Team Cuginos.1',    null,                              null, 'AVD',    'SG-CUGINOS', 'email', null, 1, null),
  ('Nick Fowler',       'Team Cuginos.2',    null,                              null, 'AVD',    'SG-CUGINOS', 'email', null, 1, null),
  ('Jr/Diz',            'Jr/Diz',            null,                              null, 'RM',     null,         'text',  null, 2, 'No email. Identity unresolved.'),
  ('Eric Nards',        'Eric Nards',        'En927898@gmail.com',              null, 'RM',     null,         'email', null, 1, null),
  ('Brian Yost',        'Brian Yost',        'brianyost25@gmail.com',           null, 'AVD',    null,         'email', null, 1, null),
  ('Billy Agnes',       'Breeze (Agnes)',    'bagnes28@gmail.com',              null, 'DIRECT', null,         'email', null, 1, null),
  ('Jerry Gialloreto',  'Jerry G',           'jpgialloreto@comcast.net',        null, 'DIRECT', null,         'email', null, 1, null),
  ('Anthony Astorga',   'Ant Astorga',       'aastorga44@gmail.com',            null, 'DIRECT', null,         'email', null, 2, 'Two blocks committed'),
  ('Anthony Garbarino', 'Ant Gab',           'anthonygab@comcast.net',          null, 'DIRECT', null,         'email', null, 1, null),
  ('Gregory DellaPia',  'Bo-Gang',           'gregster88@aol.com',              null, 'DIRECT', null,         'email', null, 1, null),
  ('Anthony Giletto',   'Ant Giletto',       'acgiletto@gmail.com',             null, 'DIRECT', null,         'email', null, 1, null),
  ('Billy Fulg',        'Billy Fulg',        null,                              null, 'DIRECT', null,         'text',  null, 1, 'No email, committed by text'),
  ('Nicco Esgro',       'Nicco Esgro',       'esgro6@gmail.com',                null, 'DIRECT', null,         'email', null, 1, null),
  ('Anthony Esgro',     'Anthony Esgro',     'anthonye@mmmail.net',             null, 'DIRECT', null,         'email', null, 1, 'aka "Scro"'),
  ('frank animal',      'frank animal',      null,                              null, 'DIRECT', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('M & M',             'M & M',             null,                              null, 'DIRECT', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('Mike capelli',      'Mike capelli',      'mcapellitcb@gmail.com',           null, 'DIRECT', null,         'in_person', 'via Anthony Esgro', 1, 'Email unverified'),
  ('Tony capelli',      'Tony capelli',      null,                              null, 'DIRECT', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('Marc Massimino',    'Marc Massimino',    'mmassimino@msn.com',              null, 'DIRECT', null,         'email', null, 1, null),
  ('Anthony Messina',   'Ant Messina',       'vafangul@comcast.net',            null, 'DIRECT', null,         'email', null, 1, null),
  ('Mario Tropea',      'Mario Tropea',      'mariocentercity@gmail.com',       null, 'DIRECT', null,         'email', null, 1, null),
  ('Nick DiVirgilio',   'Nick DiVirgilio',   'nicholasdivirgilio125@gmail.com', null, 'DIRECT', null,         'email', null, 1, null);

-- ---------------------------------------------------------------------------
-- Blocks with chosen numbers → reserved. Block 99 was "assigned" to Gambino
-- by a test in the previous system; payment is unproven, so it seeds
-- reserved (spec 6.4).
-- ---------------------------------------------------------------------------

update blocks b set
  participant_id = p.id,
  status = 'reserved',
  assignment_method = v.method,
  notes = v.note
from (values
  (99, 'Robert Gambino',    'requested', 'Payment disputed — do not promote without a verified $500'),
  (34, 'Stephen Tomiselli', 'carryover', 'Carryover from 2025'),
  (36, 'Jr/Diz',            'requested', null),
  (38, 'Jr/Diz',            'requested', null),
  ( 7, 'Eric Nards',        'requested', null),
  (28, 'Billy Agnes',       'requested', null),
  (15, 'Nicco Esgro',       'requested', null),
  ( 5, 'Anthony Esgro',     'requested', null),
  (17, 'frank animal',      'requested', null),
  (27, 'M & M',             'requested', null),
  (47, 'Mike capelli',      'requested', null),
  ( 8, 'Tony capelli',      'requested', null),
  (22, 'Anthony Messina',   'requested', null)
) as v(block_number, full_name, method, note)
join participants p on p.full_name = v.full_name
where b.block_number = v.block_number;

-- ---------------------------------------------------------------------------
-- Payments (spec 6.4). Venmo transaction IDs are the dedupe key.
-- No payment for Rob Gambino: his $500 is disputed and stays off the ledger.
-- ---------------------------------------------------------------------------

insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id, note)
select p.id, 50000, 'venmo', date '2026-08-21', '4668875750736929799', null
  from participants p where p.full_name = 'Nicco Esgro';

insert into payments (participant_id, amount_cents, method, paid_on, venmo_txn_id, note)
select p.id, 50000, 'venmo', date '2026-08-21', '4668667079197262900', 'Memo: "Thursday block" (pulled from Venmo email)'
  from participants p where p.full_name = 'Anthony Giletto';

-- Full payment promotes ALL reserved blocks (spec section 3): Nicco Esgro is
-- paid in full, so #15 is Assigned. Anthony Giletto is paid in full but has
-- not chosen a number yet — nothing to promote until he does.

update blocks b set status = 'assigned', assigned_at = now()
from participants p
where p.full_name = 'Nicco Esgro' and b.participant_id = p.id and b.status = 'reserved';

-- Seed provenance in the audit log.
insert into audit_log (actor, action, target_table, target_id, note)
values ('seed', 'seed_2026', 'games', null, '23 games, 25 participants, 27 committed blocks, 2 verified payments');
