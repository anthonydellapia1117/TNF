-- The eight owner codes, and who each one is.
--
-- Until now AVD, RM, MAP, JPOD, EJD, NL, GD and BG existed only as a CHECK
-- constraint on participants.owner_group: eight bare strings with no person
-- attached. NL and BG were the sharp end of that. Both codes shipped in the
-- schema (NL from the start, BG in migration 19) and neither had a name
-- anywhere in the repo or the database, so reconciling either owner's book at
-- season end meant asking Anthony who the code belonged to.
--
-- This table closes that. It is the mapping, not a new authority: what a code
-- MEANS is unchanged and lives in CLAUDE.md under "Owner codes and how money
-- is actually collected". A code is collection responsibility, not
-- provenance. It records which owner collects a participant's $500 and holds
-- it, and nothing else.
--
-- WHY THIS MIGRATION SEEDS NO EMAIL ADDRESSES.
-- The repo github.com/anthonydellapia1117/TNF is PUBLIC. A real email address
-- in a tracked file is an address published to the open internet permanently,
-- and deleting the line later does not remove it from the git history. A
-- migration is a tracked file like any other, so the addresses cannot be
-- seeded here either -- the first draft of this migration seeded all eight and
-- was wrong for exactly the reason its own comment gave.
--
-- The addresses are therefore provisioned OUT OF BAND, once, by an admin
-- running the update below against the database directly. They live only in
-- the owners table, which is admin-only on the same footing as
-- pending_actions: RLS on is_admin(), anon holds no privilege at all, and no
-- v_public_* view selects from it. docs/OWNERS.md carries the codes and the
-- names and no addresses, and points here.
--
--   -- Run by hand, never committed. One line per owner, real address inline:
--   update owners set email = '<address>' where code = 'AVD';
--
-- tests/sql/19_owners.sql asserts this migration seeds zero addresses, so
-- re-adding one to this file fails the suite rather than shipping quietly.
--
-- The table is a lookup, not a foreign key. participants.owner_group keeps its
-- CHECK constraint: a FK here would let a delete or rename in this table
-- silently invalidate live participant rows, and the audit log records what
-- was true at the time. Retiring a code is a new migration, as DIRECT was in
-- migration 13, never a delete from this table.

create table owners (
  code text primary key
    check (code = any (array['AVD','RM','MAP','JPOD','EJD','NL','GD','BG'])),
  full_name text not null check (length(btrim(full_name)) > 0),
  -- Nullable BY DESIGN. A fresh database has the codes and the names and no
  -- contact detail until an admin provisions it out of band; NOT NULL here
  -- would force this file to carry the addresses, which is the thing being
  -- prevented. The check still rejects a malformed address when one is set.
  email text check (email is null or position('@' in email) > 1),
  alt_email text check (alt_email is null or position('@' in alt_email) > 1),
  notes text,
  added_on date not null default current_date
);

comment on table owners is
  'Who each owner code belongs to. Collection responsibility, not provenance: '
  'the owner named here collects from his own participants and holds that cash, and '
  'pays his own winners out of it first. Admin-only, never in a public view.';

comment on column owners.email is
  'Admin-only, and provisioned out of band -- never seeded by a migration, and '
  'never copied into a repo file, a public view, or a report. The repo is public.';

insert into owners (code, full_name, notes) values
  ('AVD',  'Anthony DellaPia',
   'Pool admin. AVD is his own book; DIRECT was folded into it in migration 13.'),
  ('RM',   'Ronnie Malandro',    null),
  ('MAP',  'Michael Pungitore',  null),
  ('JPOD', 'Julian Podagrosi',
   'Precedent 2026-09-03: his word that he was holding Konnor McGrorty''s $500 is the payment record for his own book.'),
  ('EJD',  'Ernie DellaPia Jr.', null),
  ('NL',   'Nolan Lawrence',
   'Named 2026-09-09. The code existed with no person attached until then.'),
  ('GD',   'Gregory DellaPia',   null),
  ('BG',   'Billy Guyon',
   'Added as a code in migration 19 on 2026-09-04, named 2026-09-09. Before the code existed his people were filed under another owner, which attributed his money to an owner who never touched it.');

-- Admin-only, exactly as pending_actions: RLS on is_admin(), anon gets nothing.
alter table owners enable row level security;

create policy admin_read_owners on owners
  for select using (is_admin());

revoke all on owners from public, anon, authenticated;
grant select on owners to authenticated;
