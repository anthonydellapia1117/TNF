# The eight owner codes

Who each code belongs to. **There is no owner table in the schema** was true
until 2026-09-10; `owner_group` was a bare `CHECK` constraint on
`participants`, eight strings with no person attached. Migration 25 adds an
admin-only `owners` table and this file is its readable copy.

What a code MEANS has not changed and is not defined here. That lives in
CLAUDE.md under *Owner codes and how money is actually collected*: a code is
**collection responsibility, not provenance**. It records which owner collects
a participant's $500 and holds it, and nothing else.

| Code | Owner | Since |
|------|-------|-------|
| AVD | Anthony DellaPia | pool admin, and his own book |
| RM | Ronnie Malandro | |
| MAP | Michael Pungitore | |
| JPOD | Julian Podagrosi | |
| EJD | Ernie DellaPia Jr. | |
| NL | Nolan Lawrence | named 2026-09-09 |
| GD | Gregory DellaPia | |
| BG | Billy Guyon | code added 2026-09-04 (migration 19), named 2026-09-09 |

`DIRECT` was retired 2026-08-28 (migration 13) and folded into AVD. It is
rejected on insert and on update. History was deliberately not rewritten:
audit rows still carry `DIRECT` in their `before` payloads, which is correct.

## How the addresses get into the table

They are **provisioned out of band**, by hand, once. Migration 25 seeds the
codes, the names and the notes and no contact detail at all, because a
migration is a tracked file like any other. The first
draft of that migration seeded all eight addresses ten lines below a comment
saying they must never be in a repo file; seven of the eight were not in the
repo anywhere before that, and it took a review to catch it.

So, against the database directly and never committed:

```
update owners set email = '<address>' where code = 'AVD';
```

`tests/sql/19_owners.sql` asserts the migration seeds zero addresses, and
`tests/unit/no-published-emails.test.ts` fails on any address added to any
migration. Both were checked by putting an address back and confirming they
go red.

## Why there are no email addresses on this page

**A repository is the wrong place for contact detail, private or not.** Eight
real addresses in a tracked file are eight addresses committed permanently:
deleting the file later does not reach the git history, visibility is a setting
that can be changed back, and a repo has no row-level access control at all.
Anthony made this repo private on 2026-09-10. That removed the urgency and
none of the reasons.

The addresses are in the `owners` table instead, which is admin-only on the
same footing as `pending_actions`: RLS on `is_admin()`, `anon` holds no
privilege at all, and no `v_public_*` view selects from it. Read them as the
admin:

```sql
select code, full_name, email, alt_email from owners order by code;
```

You should see eight rows. A non-admin session sees zero, which
`tests/sql/19_owners.sql` asserts by actually dropping to the `authenticated`
role rather than by declaring it.

This is the same rule the public surfaces already follow: never expose email,
phone, or amounts owed. It applies to repo files too, and this file is the
reason to check that before writing contact detail into one.

## What the table is not

- **Not a foreign key.** `participants.owner_group` keeps its `CHECK`
  constraint. A foreign key would let a delete or a rename here silently
  invalidate live participant rows, and the audit log records what was true at
  the time.
- **Not an authority on money.** An owner's word is the payment record for his
  own book; that rule is in CLAUDE.md and this table does not touch it.
- **Not where a code gets retired.** Retiring one is a new migration, the way
  `DIRECT` was, never a delete from this table.

## Where each owner stands

Read live, never cached here, since it moves every time a block does:

```sql
select o.code, o.full_name,
       count(distinct p.id) as participants,
       count(*) filter (where b.status in ('reserved','assigned')) as committed_blocks
from owners o
left join participants p on p.owner_group = o.code
left join blocks b on b.participant_id = p.id
group by o.code, o.full_name
order by o.code;
```

At 2026-09-10 that was AVD 24 committed blocks, RM 23, MAP 7, JPOD 1, BG 1,
and EJD, GD and NL none. 56 committed in total.
