-- Row-level security (spec 2.4). Same model as the Survivor app:
--  * No service-role key anywhere. Admin reads and writes run as the
--    signed-in session; is_admin() enforces at the database.
--  * Public reads flow through the v_public_* projections (definer views over
--    admin-only tables) plus config. Raw participants, payments, and
--    v_participant_finance are never publicly readable.

-- The admin identity. The app.admin_email GUC wins when set; the literal
-- fallback matches the ADMIN_EMAIL env var (hosted roles cannot ALTER DATABASE).
create or replace function is_admin() returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'email', '') <> ''
     and auth.jwt() ->> 'email' = coalesce(
           nullif(current_setting('app.admin_email', true), ''),
           'anthonydellapia@gmail.com'
         )
$$;

alter table participants enable row level security;
alter table blocks enable row level security;
alter table payments enable row level security;
alter table games enable row level security;
alter table payouts enable row level security;
alter table audit_log enable row level security;
alter table config enable row level security;

-- Public read: config only (pool price, payout table, deadline — all public
-- numbers). Everything else public flows through the v_public_* views.
create policy public_read_config on config for select using (true);

-- Admin policies. Blocks get UPDATE only (the 100-row set is closed) and
-- payments get INSERT only (the ledger is append-only) — the schema triggers
-- back both rules up regardless of role.
create policy admin_all_participants on participants for all using (is_admin()) with check (is_admin());
create policy admin_read_blocks  on blocks for select using (is_admin());
create policy admin_write_blocks on blocks for update using (is_admin()) with check (is_admin());
create policy admin_read_payments   on payments for select using (is_admin());
create policy admin_insert_payments on payments for insert with check (is_admin());
create policy admin_all_games on games for all using (is_admin()) with check (is_admin());
create policy admin_all_payouts on payouts for all using (is_admin()) with check (is_admin());
create policy admin_all_audit on audit_log for all using (is_admin()) with check (is_admin());
create policy admin_write_config on config for update using (is_admin()) with check (is_admin());

-- Finance views obey RLS through the caller (non-admins see zero rows).
-- The public views and v_pot stay definer on purpose: they are the
-- deliberate public projections over admin-only tables.
alter view v_participant_finance set (security_invoker = on);

-- Belt and braces: anon never selects the finance view at all.
revoke select on v_participant_finance from anon;
