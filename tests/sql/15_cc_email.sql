-- A second contact on a participant (migration 20).
--
-- Some blocks are held by two people — block 1 is Raychel Neil and her father
-- Ray Vassallo, block 29 is Tim Flaherty and Mark Kap. cc_email reaches the
-- second person. It is a CONTACT DETAIL and nothing else: no row, no block,
-- no money, and never public.
begin;

select set_config('request.jwt.claims',
  '{"email":"anthonydellapia@gmail.com"}', true);

-- Stored on create, and changed on update.
do $$
declare v_id uuid; v_cc text; v_blocks int; v_due bigint;
begin
  v_id := admin_upsert_participant(null,'CC Probe','CC','primary@x.com',null,
            'AVD',null,'email',null,1,null,'test','second@y.com');
  select cc_email into v_cc from participants where id = v_id;
  if v_cc is distinct from 'second@y.com' then
    raise exception 'TEST FAILURE: cc_email not stored on create, got %',
      coalesce(v_cc,'null');
  end if;

  v_id := admin_upsert_participant(v_id,'CC Probe','CC','primary@x.com',null,
            'AVD',null,'email',null,1,null,'test','changed@z.com');
  select cc_email into v_cc from participants where id = v_id;
  if v_cc is distinct from 'changed@z.com' then
    raise exception 'TEST FAILURE: cc_email not updated, got %',
      coalesce(v_cc,'null');
  end if;

  -- Blank clears it rather than storing an empty string.
  v_id := admin_upsert_participant(v_id,'CC Probe','CC','primary@x.com',null,
            'AVD',null,'email',null,1,null,'test','');
  select cc_email into v_cc from participants where id = v_id;
  if v_cc is not null then
    raise exception 'TEST FAILURE: blank cc_email stored as %, expected null', v_cc;
  end if;
end $$;

-- IT IS NOT A SECOND PARTICIPANT. A cc adds no block and no money — this is
-- the whole reason it is a column rather than another row.
do $$
declare v_before int; v_after int; v_due_before bigint; v_due_after bigint; v_id uuid;
begin
  select count(*) into v_before from participants;
  select coalesce(sum(amount_due_cents),0) into v_due_before from v_participant_finance;

  v_id := admin_upsert_participant(null,'Solo Holder','SOLO','one@x.com',null,
            'AVD',null,'email',null,1,null,'test','two@x.com');

  select count(*) into v_after from participants;
  select coalesce(sum(amount_due_cents),0) into v_due_after from v_participant_finance;

  if v_after <> v_before + 1 then
    raise exception 'TEST FAILURE: a cc_email created % rows, expected 1',
      v_after - v_before;
  end if;
  if v_due_after <> v_due_before + 50000 then
    raise exception 'TEST FAILURE: a cc_email changed due by %, expected one block',
      v_due_after - v_due_before;
  end if;
end $$;

-- The 12-argument call still resolves. The deployed app does not send
-- p_cc_email; if this stops working, every admin write breaks between the
-- migration landing and the deploy finishing.
do $$
declare v_id uuid;
begin
  v_id := admin_upsert_participant(null,'Legacy Caller','LEG','legacy@x.com',
            null,'AVD',null,'email',null,1,null,'test');
  if (select cc_email from participants where id = v_id) is not null then
    raise exception 'TEST FAILURE: the defaulted cc_email did not default to null';
  end if;
end $$;

-- NEVER PUBLIC. Email is admin-only everywhere in this schema and the second
-- address is no different. Anti-vacuity first: there must be a cc to leak.
do $$
declare n int;
begin
  select count(*) into n from participants where cc_email is not null;
  if n = 0 then
    raise exception 'no cc_email rows exist — the leak check below is vacuous';
  end if;
end $$;

set local role anon;
select set_config('request.jwt.claims', '', true);
do $$
declare n int;
begin
  -- anon cannot read participants at all, which is what keeps cc_email private.
  select count(*) into n from participants;
  if n <> 0 then
    raise exception 'TEST FAILURE: anon read % participant rows', n;
  end if;
  -- and no public projection carries it.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name in ('v_public_blocks','v_public_games','v_public_payouts','v_pot')
       and column_name = 'cc_email'
  ) then
    raise exception 'TEST FAILURE: cc_email appears on a public projection';
  end if;
end $$;
reset role;

rollback;
