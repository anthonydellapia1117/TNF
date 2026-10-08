-- Migration 35: an address that is never stored, enforced by the database.
--
-- blocked_address_hashes holds the sha256 (hex) of lower(btrim(address)) for
-- each address the pool must never store, write or address. A trigger on
-- every table that holds an address (owners, participants, prospects) rejects
-- any write whose address column hashes to a row, so the rule holds whichever
-- path the write takes: an RPC, an import, or a hand-run statement.
--
-- THE HASHES ARE SEEDED BY HAND, NEVER BY A MIGRATION. The repo is public, and
-- the hash of a known address is a way to confirm it. This file creates the
-- table empty; admin_block_address_hash() adds a row, audited.
--
-- Security, as owners and pending_actions: RLS on is_admin(), anon holds no
-- privilege, authenticated gets SELECT under RLS and nothing else. The trigger
-- function is SECURITY DEFINER so it reads every row whoever the writer is; a
-- reader that RLS hid rows from would pass every address.

create table blocked_address_hashes (
  hash       text primary key check (hash ~ '^[0-9a-f]{64}$'),
  reason     text not null check (length(btrim(reason)) > 0),
  created_at timestamptz not null default now()
);

alter table blocked_address_hashes enable row level security;
create policy admin_read_blocked_address_hashes on blocked_address_hashes
  for select using (is_admin());
revoke all on blocked_address_hashes from public, anon, authenticated;
grant select on blocked_address_hashes to authenticated;

comment on table blocked_address_hashes is
  'sha256 hex of lower(btrim(address)) for each address never stored. Seeded by '
  'hand through admin_block_address_hash(), never by a migration. Admin-only.';

create or replace function address_hash(p_address text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(lower(btrim(p_address)), 'UTF8')), 'hex')
$$;

-- Trigger arguments name the address columns to check. The error names the
-- table and column and never the value.
create or replace function reject_blocked_address()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_col text;
  v_val text;
begin
  foreach v_col in array tg_argv loop
    v_val := to_jsonb(new) ->> v_col;
    if nullif(btrim(coalesce(v_val, '')), '') is not null
       and exists (select 1 from blocked_address_hashes b where b.hash = address_hash(v_val)) then
      raise exception 'blocked address: %.% is on blocked_address_hashes and is never stored', tg_table_name, v_col
        using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $$;

revoke execute on function reject_blocked_address() from public, anon, authenticated;
revoke execute on function address_hash(text)       from public, anon, authenticated;

create trigger owners_reject_blocked_address
  before insert or update on owners
  for each row execute function reject_blocked_address('email', 'alt_email');

create trigger participants_reject_blocked_address
  before insert or update on participants
  for each row execute function reject_blocked_address('email', 'cc_email');

create trigger prospects_reject_blocked_address
  before insert or update on prospects
  for each row execute function reject_blocked_address('email');

-- Add one hash. Refuses while any stored address still hashes to it: clean the
-- rows first, then block, so a blocked address is never sitting in a row the
-- trigger would only catch on its next write.
create or replace function admin_block_address_hash(
  p_hash text,
  p_reason text,
  p_actor text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_h text := lower(btrim(coalesce(p_hash, '')));
  v_n int;
begin
  perform assert_admin();
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'actor required';
  end if;
  if v_h !~ '^[0-9a-f]{64}$' then
    raise exception 'hash must be 64 hex characters: sha256 of lower(btrim(address))';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'a reason is required';
  end if;

  select count(*) into v_n from (
    select address_hash(email) as h from owners where email is not null
    union all select address_hash(alt_email) from owners where alt_email is not null
    union all select address_hash(email) from participants where email is not null
    union all select address_hash(cc_email) from participants where cc_email is not null
    union all select address_hash(email) from prospects
  ) s where s.h = v_h;
  if v_n > 0 then
    raise exception 'refused: % stored address column(s) still hold that address; remove them first', v_n;
  end if;

  insert into blocked_address_hashes (hash, reason) values (v_h, btrim(p_reason))
  on conflict (hash) do nothing;
  if not found then
    return;
  end if;

  insert into audit_log (actor, action, target_table, target_id, after)
  values (p_actor, 'block_address_hash', 'blocked_address_hashes', v_h,
          jsonb_build_object('reason', btrim(p_reason)));
end $$;

revoke execute on function admin_block_address_hash(text,text,text) from public, anon;
grant execute on function admin_block_address_hash(text,text,text) to authenticated;
