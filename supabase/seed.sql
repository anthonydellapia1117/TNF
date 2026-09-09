-- Seed data (spec section 6). Names are stored verbatim, case preserved.
--
-- Spec 6.3's header says "26 blocks committed" but its table lists 27 rows
-- (13 with numbers, 14 without). The table is the source of truth; the app
-- computes every count live, so nothing depends on the summary figure.

-- ---------------------------------------------------------------------------
-- Games: none seeded here since 2026-09-08. The 10 holiday games are inserted
-- by migration 20260908000024_season_restructure.sql, which also archives and
-- deletes whatever was in the table before it (the 23-game slate on
-- production, nothing on a fresh local database). One source, one shape.
-- ---------------------------------------------------------------------------


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
values ('seed', 'seed_2026', 'games', null, 'games from migration 24, 25 participants, 27 committed blocks, 2 verified payments');
