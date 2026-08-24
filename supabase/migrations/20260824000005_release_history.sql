-- V2 Part B4 + H1: nothing is ever deleted. Releasing a block keeps the
-- prior holder's trail in the block's notes (on top of the audit row), and
-- the carryover-unconfirmed blocks get a one-tap confirm.

create or replace function admin_release_block(p_block_number int, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_holder text;
  v_history text;
begin
  perform assert_admin();
  select to_jsonb(b) into v_before from blocks b where b.block_number = p_block_number for update;
  if v_before is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  select coalesce(p.display_alias, p.full_name) into v_holder
    from participants p where p.id = (v_before ->> 'participant_id')::uuid;
  v_history := case
    when v_holder is not null then
      'Released from ' || v_holder || ' on ' || to_char(now(), 'YYYY-MM-DD')
      || case when nullif(v_before ->> 'notes', '') is not null
              then ' · prior note: ' || (v_before ->> 'notes') else '' end
    else nullif(v_before ->> 'notes', '')
  end;
  update blocks
     set participant_id = null, status = 'available', assignment_method = null,
         requested_ref = null, assigned_at = null, notes = v_history
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'release_block', 'blocks', p_block_number::text, v_before);
end $$;

-- H1: Scro confirms a carried-over number is what his guy actually wants.
create or replace function admin_confirm_carryover(p_block_number int, p_actor text) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
begin
  perform assert_admin();
  select to_jsonb(b) into v_before from blocks b where b.block_number = p_block_number for update;
  if v_before is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  if v_before ->> 'assignment_method' <> 'carryover' then
    raise exception 'block % is not a carryover', p_block_number;
  end if;
  update blocks
     set assignment_method = 'requested',
         notes = 'carryover confirmed as requested on ' || to_char(now(), 'YYYY-MM-DD')
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'confirm_carryover', 'blocks', p_block_number::text, v_before);
end $$;

do $$
begin
  execute 'revoke execute on function admin_confirm_carryover(int,text) from public, anon';
  execute 'grant execute on function admin_confirm_carryover(int,text) to authenticated';
end $$;
