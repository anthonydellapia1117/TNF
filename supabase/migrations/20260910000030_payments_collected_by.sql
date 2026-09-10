-- Who actually collected this payment.
--
-- CLAUDE.md: money that reaches Anthony moves the participant to AVD, in the
-- same operation as the payment. Cash an owner collects and holds for his own
-- book is the exception and moves nobody. admin_record_payment has never done
-- either - it inserts the ledger row and promotes, and does not touch
-- participants.owner_group - so approving a staged payment for someone in RM's
-- or MAP's book left him in the wrong book.
--
-- It could not be fixed by reading the existing data. The rule needs to know
-- which of the two cases a payment is, and the ledger only said so in prose:
-- all 29 cash rows carry a source_ref like "Held by Ronnie Malandro (RM),
-- confirmed by him to Anthony 2026-09-04", with the owner inside a sentence
-- rather than in a field, and 2 of the 19 venmo rows carry no source_ref at
-- all. Deciding money attribution by grepping prose is the guessing CLAUDE.md
-- forbids on exactly this data, so the fact gets a column.
--
-- NULL MEANS ANTHONY, and that is deliberate rather than an absence. He is the
-- default collector; an owner holding cash is the case that has to be recorded.
-- So an unclassified historical row and a new Venmo receipt both read the same
-- way, and both move the participant to AVD, which is the correct outcome for
-- both. Migration 31 makes admin_record_payment act on it.

alter table payments
  add column collected_by text
    check (collected_by is null
           or collected_by = any (array['AVD','RM','MAP','JPOD','EJD','NL','GD','BG']));

comment on column payments.collected_by is
  'Owner code of whoever collected and holds this money. NULL means Anthony '
  'collected it, which is the default: an owner holding his own book''s cash is '
  'the case that must be recorded. Drives the AVD move in admin_record_payment.';

-- THE BACKFILL HAS TO STEP AROUND THE APPEND-ONLY TRIGGER, DELIBERATELY.
--
-- payments carries a BEFORE UPDATE OR DELETE trigger that raises
-- unconditionally: "payments is append-only; corrections are new rows". A plain
-- UPDATE here fails, and it failed on the production rehearsal of this exact
-- migration before it was applied - which is the only reason this comment
-- exists rather than a broken deploy.
--
-- The trigger is disabled and re-enabled inside this migration, and nothing in
-- this repo has ever done that before. It is justified narrowly: append-only
-- protects the MONEY FACTS - amount, method, date, who it was for - and none of
-- those is touched. collected_by is a new column being populated for the first
-- time, from prose that was already in the same row. No row's meaning changes.
--
-- A migration runs in one transaction, so a failure anywhere below rolls the
-- disable back with it and the guard is never left off. The assertion at the
-- bottom is the belt to that braces: if the trigger is not enabled when this
-- migration finishes, the migration fails rather than leaving the ledger
-- writable. tests/sql/21 asserts the same thing against the built database.

alter table payments disable trigger payments_append_only;

-- Backfill from the prose, and ONLY where the prose is unambiguous.
--
-- An owner matches when his CODE appears as a whole word - bounded by a
-- non-alphanumeric on each side, so a hex message id like 1a08471146878e23
-- cannot match GD or NL out of its middle - or when his FULL NAME appears as a
-- literal substring. position() rather than ILIKE so that no character in a
-- name is read as a wildcard.
--
-- Exactly one owner must match. Zero matches or two both leave NULL. The count
-- of NULLs is the honest output here and is not driven to zero: 19 of 48 rows
-- name nobody, every one of them a Venmo receipt or an instruction from Anthony
-- himself, which is precisely the case NULL is meant to carry.
-- The rule lives in a FUNCTION, not inline in the UPDATE, so that the suite can
-- exercise the thing that ships instead of a copy of it. The first draft of
-- tests/sql/21 re-typed this expression into the test, which meant loosening
-- the migration changed nothing the test could see - a dead assertion of the
-- same family as the migration 15/16 case in CLAUDE.md, caught by mutating the
-- migration and watching the suite stay green.
create or replace function payment_owner_from_prose(p_source_ref text)
returns text
language sql
stable
set search_path = public, pg_temp
as $fn$
  select case when count(distinct o.code) = 1 then min(o.code) else null end
    from owners o
   where p_source_ref is not null
     and (p_source_ref ~ ('(^|[^A-Za-z0-9])' || o.code || '([^A-Za-z0-9]|$)')
          or position(lower(o.full_name) in lower(p_source_ref)) > 0)
$fn$;

comment on function payment_owner_from_prose(text) is
  'Reads an owner code out of a payment source_ref, and only when exactly one '
  'owner matches. Zero matches or two both return NULL, because the money '
  'attribution of an ambiguous row is a question for Anthony, not a guess.';

revoke execute on function payment_owner_from_prose(text) from public, anon;
grant execute on function payment_owner_from_prose(text) to authenticated;

update payments p
   set collected_by = payment_owner_from_prose(p.source_ref)
 where p.source_ref is not null
   and payment_owner_from_prose(p.source_ref) is not null;

alter table payments enable trigger payments_append_only;

-- The guard is back on, or this migration does not finish.
do $$
declare v_enabled char;
begin
  select t.tgenabled into v_enabled
    from pg_trigger t
   where t.tgrelid = 'payments'::regclass
     and t.tgname = 'payments_append_only';
  if v_enabled is null then
    raise exception 'payments_append_only trigger is missing after the backfill';
  end if;
  if v_enabled = 'D' then
    raise exception 'payments_append_only is still DISABLED after the backfill - the ledger is writable';
  end if;
end $$;
