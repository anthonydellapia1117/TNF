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
-- WHY THE EMAIL ADDRESSES LIVE HERE AND NOT IN A REPO FILE.
-- The repo github.com/anthonydellapia1117/TNF is PUBLIC. Eight real email
-- addresses in a tracked file are eight addresses published to the open
-- internet, permanently, and a delete does not remove them from the history.
-- docs/OWNERS.md therefore carries the codes and the names only and points
-- here for contact detail. This table is admin-only, on the same footing as
-- pending_actions: RLS on is_admin(), anon holds no privilege at all, and no
-- v_public_* view selects from it. That also satisfies the standing rule that
-- a public surface never exposes email.
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
  email text not null check (position('@' in email) > 1),
  alt_email text,
  notes text,
  added_on date not null default current_date
);

comment on table owners is
  'Who each owner code belongs to. Collection responsibility, not provenance: '
  'the owner named here collects from his own participants and holds that cash, and '
  'pays his own winners out of it first. Admin-only, never in a public view; '
  'the email addresses are here rather than in the public repo.';

comment on column owners.email is
  'Admin-only. Never copy into a repo file, a public view, or a report.';

insert into owners (code, full_name, email, alt_email, notes) values
  ('AVD',  'Anthony DellaPia',   'anthonydellapia@gmail.com', 'anthony.dellapia@us.gt.com',
   'Pool admin. AVD is his own book; DIRECT was folded into it in migration 13.'),
  ('RM',   'Ronnie Malandro',    'ronmalandro@gmail.com',     null, null),
  ('MAP',  'Michael Pungitore',  'michael.pungitore@gmail.com', null, null),
  ('JPOD', 'Julian Podagrosi',   'jpodagrosi17@gmail.com',    null,
   'Precedent 2026-09-03: his word that he was holding Konnor McGrorty''s $500 is the payment record for his own book.'),
  ('EJD',  'Ernie DellaPia Jr.', 'dellapia706@gmail.com',     null, null),
  ('NL',   'Nolan Lawrence',     'nolan.a.lawrence@gmail.com', null,
   'Named 2026-09-09. The code existed with no person attached until then.'),
  ('GD',   'Gregory DellaPia',   'gregster88@aol.com',        null, null),
  ('BG',   'Billy Guyon',        'wguyon215@gmail.com',       null,
   'Added as a code in migration 19 on 2026-09-04, named 2026-09-09. Before the code existed his people were filed under another owner, which attributed his money to an owner who never touched it.');

-- Admin-only, exactly as pending_actions: RLS on is_admin(), anon gets nothing.
alter table owners enable row level security;

create policy admin_read_owners on owners
  for select using (is_admin());

revoke all on owners from public, anon, authenticated;
grant select on owners to authenticated;
