-- Seed data (spec section 6). Names are stored verbatim, case preserved.
--
-- Spec 6.3's header says "26 blocks committed" but its table lists 27 rows
-- (13 with numbers, 14 without). The table is the source of truth; the app
-- computes every count live, so nothing depends on the summary figure.

-- ---------------------------------------------------------------------------
-- Games: 23 total — 15 regular, 8 holiday. Payouts sum to exactly $44,250.
--
-- The real 2026 schedule, pulled from nflverse (nfldata games.csv) and
-- cross-verified game-for-game against ESPN, including kickoff times and
-- networks. The slate is every Thursday game plus the holiday package
-- (3 Thanksgiving, 1 Christmas Eve, 3 Christmas Day, 1 New Year's Eve) and
-- the Wednesday season opener the spec pins as G01. The one judgment call:
-- the schedule also has a Wednesday Thanksgiving-eve special (GB @ LA,
-- Nov 25, Netflix) which is NOT included — including it would give 24
-- games and put four games in the Thanksgiving week, and the spec says
-- Thanksgiving has three. Swap it in at /admin/games if the pool wants it.
--
-- G19 and G23 ship with date_confirmed = false (spec 6.2) even though the
-- league dates exist — late-December games can flex; confirming is one tap.
-- ---------------------------------------------------------------------------

insert into games (game_no, week, kickoff_at, date_confirmed, game_type, holiday_label, away_team, home_team, network) values
  ( 1,  1, '2026-09-10 00:20:00+00', true,  'regular', null,            'New England Patriots',   'Seattle Seahawks',      'NBC'),
  ( 2,  1, '2026-09-11 00:35:00+00', true,  'regular', null,            'San Francisco 49ers',    'Los Angeles Rams',      'Netflix'),
  ( 3,  2, '2026-09-18 00:15:00+00', true,  'regular', null,            'Detroit Lions',          'Buffalo Bills',         'Prime Video'),
  ( 4,  3, '2026-09-25 00:15:00+00', true,  'regular', null,            'Atlanta Falcons',        'Green Bay Packers',     'Prime Video'),
  ( 5,  4, '2026-10-02 00:15:00+00', true,  'regular', null,            'Pittsburgh Steelers',    'Cleveland Browns',      'Prime Video'),
  ( 6,  5, '2026-10-09 00:15:00+00', true,  'regular', null,            'Tampa Bay Buccaneers',   'Dallas Cowboys',        'Prime Video'),
  ( 7,  6, '2026-10-16 00:15:00+00', true,  'regular', null,            'Seattle Seahawks',       'Denver Broncos',        'Prime Video'),
  ( 8,  7, '2026-10-23 00:15:00+00', true,  'regular', null,            'New England Patriots',   'Chicago Bears',         'Prime Video'),
  ( 9,  8, '2026-10-30 00:15:00+00', true,  'regular', null,            'Carolina Panthers',      'Green Bay Packers',     'Prime Video'),
  (10,  9, '2026-11-06 01:15:00+00', true,  'regular', null,            'Jacksonville Jaguars',   'Baltimore Ravens',      'Prime Video'),
  (11, 10, '2026-11-13 01:15:00+00', true,  'regular', null,            'Washington Commanders',  'New York Giants',       'Prime Video'),
  (12, 11, '2026-11-20 01:15:00+00', true,  'regular', null,            'Indianapolis Colts',     'Houston Texans',        'Prime Video'),
  (13, 12, '2026-11-26 18:00:00+00', true,  'holiday', 'Thanksgiving',  'Chicago Bears',          'Detroit Lions',         'CBS'),
  (14, 12, '2026-11-26 21:30:00+00', true,  'holiday', 'Thanksgiving',  'Philadelphia Eagles',    'Dallas Cowboys',        'FOX'),
  (15, 12, '2026-11-27 01:20:00+00', true,  'holiday', 'Thanksgiving',  'Kansas City Chiefs',     'Buffalo Bills',         'NBC'),
  (16, 13, '2026-12-04 01:15:00+00', true,  'regular', null,            'Kansas City Chiefs',     'Los Angeles Rams',      'Prime Video'),
  (17, 14, '2026-12-11 01:15:00+00', true,  'regular', null,            'Minnesota Vikings',      'New England Patriots',  'Prime Video'),
  (18, 15, '2026-12-18 01:15:00+00', true,  'regular', null,            'San Francisco 49ers',    'Los Angeles Chargers',  'Prime Video'),
  (19, 16, '2026-12-25 01:15:00+00', false, 'holiday', 'Christmas Eve', 'Houston Texans',         'Philadelphia Eagles',   'Prime Video'),
  (20, 16, '2026-12-25 18:00:00+00', true,  'holiday', 'Christmas Day', 'Green Bay Packers',      'Chicago Bears',         'Netflix'),
  (21, 16, '2026-12-25 21:30:00+00', true,  'holiday', 'Christmas Day', 'Buffalo Bills',          'Denver Broncos',        'Netflix'),
  (22, 16, '2026-12-26 01:15:00+00', true,  'holiday', 'Christmas Day', 'Los Angeles Rams',       'Seattle Seahawks',      'FOX'),
  (23, 17, '2027-01-01 01:15:00+00', false, 'holiday', 'New Year''s Eve', 'Baltimore Ravens',     'Cincinnati Bengals',    'Prime Video');

-- ---------------------------------------------------------------------------
-- Participants: 25 people, 27 committed blocks (Jr/Diz and Anthony Astorga
-- each committed two). blocks_requested carries commitments with no number.
-- ---------------------------------------------------------------------------

insert into participants (full_name, display_alias, email, phone, owner_group, shared_group_id, source, source_ref, blocks_requested, notes) values
  ('Robert Gambino',    'Rob Gambino',       null,                              null, 'AVD', null,         'email', null, 1,
   'PAYMENT DISPUTED: a $500 Venmo from him exists on Aug 17 (txn 4665850241799398643) but its memo is a gas-pump emoji, and no second $500 exists. Reserved and unpaid until Anthony resolves.'),
  ('Konnor McGrorty',   'Gurt',              null,                              null, 'AVD', null,         'email', null, 1, null),
  ('Stephen Tomiselli', 'Stephen Tomiselli', null,                              null, 'AVD', null,         'email', null, 1, 'Carryover from 2025'),
  ('Marc Virga',        'Team Cuginos.1',    null,                              null, 'AVD',    'SG-CUGINOS', 'email', null, 1, null),
  ('Nick Fowler',       'Team Cuginos.2',    null,                              null, 'AVD',    'SG-CUGINOS', 'email', null, 1, null),
  ('Jr/Diz',            'Jr/Diz',            null,                              null, 'RM',     null,         'text',  null, 2, 'No email. Identity unresolved.'),
  ('Eric Nards',        'Eric Nards',        'En927898@gmail.com',              null, 'RM',     null,         'email', null, 1, null),
  ('Brian Yost',        'Brian Yost',        'brianyost25@gmail.com',           null, 'AVD',    null,         'email', null, 1, null),
  ('Billy Agnes',       'Breeze (Agnes)',    'bagnes28@gmail.com',              null, 'AVD', null,         'email', null, 1, null),
  ('Jerry Gialloreto',  'Jerry G',           'jpgialloreto@comcast.net',        null, 'AVD', null,         'email', null, 1, null),
  ('Anthony Astorga',   'Ant Astorga',       'aastorga44@gmail.com',            null, 'AVD', null,         'email', null, 2, 'Two blocks committed'),
  ('Anthony Garbarino', 'Ant Gab',           'anthonygab@comcast.net',          null, 'AVD', null,         'email', null, 1, null),
  ('Gregory DellaPia',  'Bo-Gang',           'gregster88@aol.com',              null, 'AVD', null,         'email', null, 1, null),
  ('Anthony Giletto',   'Ant Giletto',       'acgiletto@gmail.com',             null, 'AVD', null,         'email', null, 1, null),
  ('Billy Fulg',        'Billy Fulg',        null,                              null, 'AVD', null,         'text',  null, 1, 'No email, committed by text'),
  ('Nicco Esgro',       'Nicco Esgro',       'esgro6@gmail.com',                null, 'AVD', null,         'email', null, 1, null),
  ('Anthony Esgro',     'Anthony Esgro',     'anthonye@mmmail.net',             null, 'AVD', null,         'email', null, 1, 'aka "Scro"'),
  ('frank animal',      'frank animal',      null,                              null, 'AVD', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('M & M',             'M & M',             null,                              null, 'AVD', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('Mike capelli',      'Mike capelli',      'mcapellitcb@gmail.com',           null, 'AVD', null,         'in_person', 'via Anthony Esgro', 1, 'Email unverified'),
  ('Tony capelli',      'Tony capelli',      null,                              null, 'AVD', null,         'in_person', 'via Anthony Esgro', 1, null),
  ('Marc Massimino',    'Marc Massimino',    'mmassimino@msn.com',              null, 'AVD', null,         'email', null, 1, null),
  ('Anthony Messina',   'Ant Messina',       'vafangul@comcast.net',            null, 'AVD', null,         'email', null, 1, null),
  ('Mario Tropea',      'Mario Tropea',      'mariocentercity@gmail.com',       null, 'AVD', null,         'email', null, 1, null),
  ('Nick DiVirgilio',   'Nick DiVirgilio',   'nicholasdivirgilio125@gmail.com', null, 'AVD', null,         'email', null, 1, null);

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
