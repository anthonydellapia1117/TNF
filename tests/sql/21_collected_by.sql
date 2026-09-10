-- payments.collected_by, and the AVD move it drives.
--
-- Every assertion that reads a value guards for NULL and raises, per the
-- CLAUDE.md rule from migrations 15 and 16: a column that comes back NULL turns
-- "if value <> expected" into a no-op and the suite reports PASS while testing
-- nothing. That rule was broken again on this branch by migration 28, which is
-- why the guards below are not optional.

-- 1. The column, its nullability, and its CHECK.
do $$
declare v_n int; v_nullable text;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='payments' and column_name='collected_by';
  if v_n is null then raise exception 'TEST FAILURE: column probe came back NULL'; end if;
  if v_n <> 1 then raise exception 'TEST FAILURE: payments.collected_by does not exist'; end if;

  select is_nullable into v_nullable from information_schema.columns
   where table_schema='public' and table_name='payments' and column_name='collected_by';
  if v_nullable is null then raise exception 'TEST FAILURE: nullability came back NULL'; end if;
  if v_nullable <> 'YES' then
    raise exception 'TEST FAILURE: collected_by is NOT NULL, but NULL is how the column says "Anthony collected it"';
  end if;

  begin
    insert into payments (participant_id, amount_cents, method, paid_on, collected_by)
    values (null, 50000, 'venmo', current_date, 'NOPE');
    raise exception 'TEST FAILURE: an off-list owner code was accepted into collected_by';
  exception when check_violation then null;
  end;
  raise notice 'collected_by: exists, nullable, CHECK rejects an unknown code';
end $$;

-- 2. THE APPEND-ONLY GUARD IS BACK ON.
--    Migration 30 disables it to run the backfill. If it were left off, the
--    ledger would be silently writable and nothing else in the suite would
--    notice. This is the assertion that makes that exception safe to take.
do $$
declare v_state char; v_blocked boolean := false;
begin
  select t.tgenabled into v_state from pg_trigger t
   where t.tgrelid = 'payments'::regclass and t.tgname = 'payments_append_only';
  if v_state is null then
    raise exception 'TEST FAILURE: the payments_append_only trigger is gone';
  end if;
  if v_state = 'D' then
    raise exception 'TEST FAILURE: payments_append_only is DISABLED - migration 30 left the ledger writable';
  end if;

  -- and prove it actually bites, rather than merely being marked enabled
  begin
    update payments set note = 'should never apply' where true;
  exception when others then v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'TEST FAILURE: an UPDATE on payments succeeded';
  end if;
  raise notice 'append-only: trigger enabled after the backfill, and an UPDATE still raises';
end $$;

-- 3. The backfill parser, against the shapes that actually occur.
--    The seed carries no prose source_ref, so asserting on seed counts would be
--    vacuous. These are the real production shapes, tested as strings.
do $$
declare r record; v_got text;
begin
  for r in
    select * from (values
      ('Held by Ronnie Malandro (RM), confirmed by him to Anthony 2026-09-04', 'RM'),
      ('Held by Mike Pungitore (MAP), confirmed by him to Anthony 2026-09-04', 'MAP'),
      ('Held by Julian Podagrosi (JPOD), confirmed by him to Anthony 2026-09-03', 'JPOD'),
      -- full name with no code present
      ('cash handed over by Nolan Lawrence at the bar', 'NL'),
      -- Anthony is not an owner match: his full name never appears in these
      ('Venmo receipt, verified by Anthony', null),
      ('Anthony instruction 2026-09-10, TNF roster update B1', null),
      -- a hex message id must not yield a code out of its middle
      ('Venmo receipt in Gmail, msg 1a08471146878e23, Sep 9 2026 12:33 AM ET', null),
      ('Venmo receipt in Gmail, thread 1a069ff17ff94593, Sep 3 2026 9:18 PM ET', null)
    ) as t(src, expected)
  loop
    -- calls the SHIPPED function, not a copy of its expression
    v_got := payment_owner_from_prose(r.src);

    if v_got is distinct from r.expected then
      raise exception 'TEST FAILURE: parser read % as %, expected %',
        left(r.src, 60), coalesce(v_got,'NULL'), coalesce(r.expected,'NULL');
    end if;
  end loop;

  -- two owners named at once must stay NULL, never pick one
  if payment_owner_from_prose('split between Ronnie Malandro (RM) and Julian Podagrosi (JPOD)') is not null then
    raise exception 'TEST FAILURE: a string naming two owners was resolved to one instead of left NULL';
  end if;
  raise notice 'backfill parser: codes, full names, hex ids and ambiguity all read correctly';
end $$;

-- 4. THE AVD MOVE. This is the money rule the column exists for.
do $$
declare
  v_p uuid; v_owner text; v_audit int; v_pay uuid;
begin
  perform set_config('app.admin_email', 'admin@tnf.test', true);
  perform set_config('request.jwt.claims', '{"email":"admin@tnf.test"}', true);

  -- 4a. NULL collected_by = Anthony collected it = the participant moves.
  insert into participants (full_name, display_alias, owner_group, blocks_requested)
  values ('Test AvdMove One', 'avdmove1', 'RM', 1) returning id into v_p;

  v_pay := admin_record_payment(v_p, 50000, 'venmo', current_date, null,
                                'Venmo receipt, verified by Anthony', null, null,
                                'admin@tnf.test', null);

  select owner_group into v_owner from participants where id = v_p;
  if v_owner is null then raise exception 'TEST FAILURE: owner_group came back NULL after the move'; end if;
  if v_owner <> 'AVD' then
    raise exception 'TEST FAILURE: money reached Anthony and the participant is still %, not AVD', v_owner;
  end if;

  select count(*) into v_audit from audit_log
   where action = 'owner_group_moved_to_avd' and target_id = v_p::text;
  if v_audit is null then raise exception 'TEST FAILURE: move-audit count came back NULL'; end if;
  if v_audit <> 1 then raise exception 'TEST FAILURE: the AVD move wrote % audit rows, expected 1', v_audit; end if;

  -- 4b. An owner holding his own book's cash moves NOBODY.
  insert into participants (full_name, display_alias, owner_group, blocks_requested)
  values ('Test AvdMove Two', 'avdmove2', 'RM', 1) returning id into v_p;

  perform admin_record_payment(v_p, 50000, 'cash', current_date, null,
                               'Held by Ronnie Malandro (RM)', null, null,
                               'admin@tnf.test', 'RM');

  select owner_group into v_owner from participants where id = v_p;
  if v_owner is null then raise exception 'TEST FAILURE: owner_group came back NULL for the owner-held case'; end if;
  if v_owner <> 'RM' then
    raise exception 'TEST FAILURE: owner-held cash moved the participant to %, and it must move nobody', v_owner;
  end if;

  -- 4c. A comp is not money reaching anyone.
  insert into participants (full_name, display_alias, owner_group, blocks_requested)
  values ('Test AvdMove Three', 'avdmove3', 'MAP', 1) returning id into v_p;

  perform admin_record_payment(v_p, 0, 'comp', current_date, null,
                               'comped block', null, null, 'admin@tnf.test', null);

  select owner_group into v_owner from participants where id = v_p;
  if v_owner is null then raise exception 'TEST FAILURE: owner_group came back NULL for the comp case'; end if;
  if v_owner <> 'MAP' then
    raise exception 'TEST FAILURE: a comp moved the participant to %, and no money reached Anthony', v_owner;
  end if;

  -- 4d. A correction adjusts a payment that already had its effect. It must
  --     not move a book a second time. This case exists because 4c alone does
  --     NOT test the method filter: a comp is 0 dollars, so the amount guard
  --     catches it either way, and removing the method filter left the suite
  --     green. A correction carries a positive amount and isolates it.
  insert into participants (full_name, display_alias, owner_group, blocks_requested)
  values ('Test AvdMove Four', 'avdmove4', 'JPOD', 1) returning id into v_p;

  perform admin_record_payment(v_p, 50000, 'correction', current_date, null,
                               'correcting an earlier row', null, v_pay,
                               'admin@tnf.test', null);

  select owner_group into v_owner from participants where id = v_p;
  if v_owner is null then raise exception 'TEST FAILURE: owner_group came back NULL for the correction case'; end if;
  if v_owner <> 'JPOD' then
    raise exception 'TEST FAILURE: a correction moved the participant to %, and a correction moves no book', v_owner;
  end if;

  raise notice 'AVD move: null collected_by moves and audits; an owner code, a comp and a correction do not';
end $$;

-- 4e. A CORRECTION INHERITS THE COLLECTOR OF THE ROW IT CORRECTS. The two are
--     the same money in the same book, so the collector is not an independent
--     fact about the correction: reversing an RM-held payment with a null
--     collector would credit RM $500 and debit Anthony $500, and every
--     season-end total grouped by owner would be wrong while the ledger
--     balanced. The CHECK correction_references_original guarantees there is
--     always a row to inherit from.
do $$
declare
  v_p uuid; v_orig uuid; v_corr uuid; v_got text;
begin
  perform set_config('app.admin_email', 'admin@tnf.test', true);
  perform set_config('request.jwt.claims', '{"email":"admin@tnf.test"}', true);

  insert into participants (full_name, display_alias, owner_group, blocks_requested)
  values ('Test Correction Inherit', 'corrinherit', 'RM', 1) returning id into v_p;

  v_orig := admin_record_payment(v_p, 50000, 'cash', current_date, null,
                                 'Held by Ronnie Malandro (RM)', null, null,
                                 'admin@tnf.test', 'RM');

  -- The admin form defaults AND resets the collector to Anthony, so this is
  -- the argument a real correction arrives with.
  v_corr := admin_record_payment(v_p, -50000, 'correction', current_date, null,
                                 'reversing it', null, v_orig,
                                 'admin@tnf.test', null);

  select collected_by into v_got from payments where id = v_corr;
  if v_got is null then
    raise exception 'TEST FAILURE: the correction was attributed to Anthony, and the row it corrects is RM';
  end if;
  if v_got <> 'RM' then
    raise exception 'TEST FAILURE: the correction carries %, and the row it corrects is RM', v_got;
  end if;

  -- A collector supplied on a correction is not a second opinion. The row
  -- being corrected is the authority, so a contradicting argument loses.
  v_corr := admin_record_payment(v_p, -50000, 'correction', current_date, null,
                                 'reversing it again', null, v_orig,
                                 'admin@tnf.test', 'MAP');

  select collected_by into v_got from payments where id = v_corr;
  if v_got is null then raise exception 'TEST FAILURE: collector came back NULL on the contradicting correction'; end if;
  if v_got <> 'RM' then
    raise exception 'TEST FAILURE: an argument overrode the corrected row and wrote %, expected RM', v_got;
  end if;

  -- And nothing else inherits: a plain receipt still takes its argument.
  v_corr := admin_record_payment(v_p, 50000, 'cash', current_date, null,
                                 'held by Michael Pungitore (MAP)', null, null,
                                 'admin@tnf.test', 'MAP');
  select collected_by into v_got from payments where id = v_corr;
  if v_got is null then raise exception 'TEST FAILURE: collector came back NULL on the plain receipt'; end if;
  if v_got <> 'MAP' then
    raise exception 'TEST FAILURE: a plain receipt lost its collector and carries %', v_got;
  end if;

  -- The line above does NOT isolate the METHOD, because it passes no
  -- corrects_payment_id: widening the condition to "corrects_payment_id is not
  -- null" left the suite green. Only `correction` inherits, and nothing stops a
  -- receipt from also naming the row it supersedes - correction_references_
  -- original constrains corrections, not the other direction. A `cash` row that
  -- names one must still take its argument, because it is money arriving, and
  -- it is what decides the AVD move.
  v_corr := admin_record_payment(v_p, 50000, 'cash', current_date, null,
                                 'held by Michael Pungitore (MAP), see the earlier row',
                                 null, v_orig, 'admin@tnf.test', 'MAP');
  select collected_by into v_got from payments where id = v_corr;
  if v_got is null then raise exception 'TEST FAILURE: collector came back NULL on the receipt that names a payment'; end if;
  if v_got <> 'MAP' then
    raise exception 'TEST FAILURE: a cash receipt naming another payment inherited % instead of keeping MAP', v_got;
  end if;

  raise notice 'correction: inherits the corrected row''s collector, argument and all; other methods keep theirs';
end $$;

-- 5. The old 9-argument signature is GONE, not sitting beside the new one.
--    Two overloads would make every 9-argument call ambiguous at run time.
do $$
declare v_9 int; v_10 int;
begin
  select count(*) into v_9 from pg_proc
   where proname = 'admin_record_payment' and pronargs = 9;
  select count(*) into v_10 from pg_proc
   where proname = 'admin_record_payment' and pronargs = 10;
  if v_9 is null or v_10 is null then
    raise exception 'TEST FAILURE: signature counts came back NULL';
  end if;
  if v_9 <> 0 then
    raise exception 'TEST FAILURE: the 9-argument admin_record_payment still exists alongside the new one';
  end if;
  if v_10 <> 1 then
    raise exception 'TEST FAILURE: expected exactly one 10-argument admin_record_payment, found %', v_10;
  end if;
  raise notice 'signature: 9-arg dropped, exactly one 10-arg remains';
end $$;
