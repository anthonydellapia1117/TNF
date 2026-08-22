-- Reserved vs Assigned and the promotion rule (spec section 3).
begin;
select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);

do $$
declare
  v_jr uuid;
  n int;
begin
  select id into v_jr from participants where full_name = 'Jr/Diz';

  -- Partial payment promotes NOTHING.
  perform admin_record_payment(v_jr, 50000, 'cash', current_date, null, null, 'first half', null, 'test');
  select count(*) into n from blocks where participant_id = v_jr and status = 'assigned';
  if n <> 0 then raise exception 'partial payment promoted % blocks', n; end if;
  select count(*) into n from blocks where participant_id = v_jr and status = 'reserved';
  if n <> 2 then raise exception 'reserved blocks disturbed'; end if;

  -- Full payment promotes ALL reserved blocks in one transaction.
  perform admin_record_payment(v_jr, 50000, 'cash', current_date, null, null, 'second half', null, 'test');
  select count(*) into n from blocks where participant_id = v_jr and status = 'assigned';
  if n <> 2 then raise exception 'full payment promoted % of 2 blocks', n; end if;

  -- Invariant after every mutation.
  if (select available + reserved + assigned + held from v_pot) <> 100 then
    raise exception 'block invariant broken by promotion';
  end if;
end $$;

-- Reserve/release keep the set closed; insert/delete never succeed.
do $$
declare
  n int;
begin
  begin
    insert into blocks (block_number) values (101);
    raise exception 'block insert was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%fixed set%' then raise; end if;
    when check_violation then null;
  end;
  begin
    delete from blocks where block_number = 1;
    raise exception 'block delete was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%fixed set%' then raise; end if;
  end;
  select count(*) into n from blocks;
  if n <> 100 then raise exception 'block count drifted to %', n; end if;
end $$;

-- Reserving an already-reserved block is refused.
do $$
declare
  v_p uuid;
begin
  select id into v_p from participants where full_name = 'Konnor McGrorty';
  begin
    perform admin_reserve_blocks(array[34], v_p, 'requested', null, 'test');
    raise exception 'double reservation was accepted';
  exception
    when raise_exception then
      if sqlerrm not like '%only an available block%' then raise; end if;
  end;
end $$;

rollback;
