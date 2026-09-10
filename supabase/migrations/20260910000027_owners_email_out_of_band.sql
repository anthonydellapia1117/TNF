-- Converge production with migration 25 as it now stands.
--
-- Migration 25 originally seeded all eight owners' email addresses and declared
-- owners.email NOT NULL. The repo is public, so that published seven addresses
-- that were not previously in it anywhere. Migration 25 has been rewritten to
-- seed the codes and the names only, and to declare email nullable, because a
-- NOT NULL forces the addresses back into a tracked file.
--
-- Production already ran the original, so it holds the addresses (correct -
-- that is where they belong) but still carries the NOT NULL and lacks the
-- alt_email check. A fresh database built from the migrations would therefore
-- differ from production on exactly the column this change is about, and
-- tests/sql/19_owners.sql assertion 4b would pass locally while being false in
-- production. That is the silent divergence CLAUDE.md warns about, so it gets
-- a numbered migration rather than a note.
--
-- NO DATA IS TOUCHED. The eight rows keep their addresses. This only relaxes a
-- constraint and adds a check that the existing data already satisfies.

alter table owners alter column email drop not null;

-- Guarded, because migration 25 declares this check INLINE on the column for a
-- fresh database, and Postgres auto-names an inline check exactly this. Without
-- the guard, a database built from the migrations in order fails here while
-- production, which predates the inline version, needs the constraint added.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'owners'::regclass
       and conname = 'owners_alt_email_check'
  ) then
    alter table owners add constraint owners_alt_email_check
      check (alt_email is null or position('@' in alt_email) > 1);
  end if;
end $$;

comment on column owners.email is
  'Admin-only, and provisioned out of band -- never seeded by a migration, and '
  'never copied into a repo file, a public view, or a report. The repo is public.';
