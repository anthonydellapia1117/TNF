-- A block can carry its own name.
--
-- Until now the name shown on a block came from its owner: display_name was
-- coalesce(participant.display_alias, participant.full_name), so every block
-- one person held wore the same name. That broke for the first owner who
-- wanted a different name on each of his two blocks.
--
-- The app was already per-block everywhere a name appears — v_public_blocks
-- is one row per block, and the grid, /players, /block/[n], the winner panel
-- and the share card all look a name up BY BLOCK NUMBER. They simply always
-- resolved to the same participant value. This lets that resolution differ.
--
-- What does NOT change: money. The name is a display concern only. Due,
-- paid, the chase surfaces and the contact-gap list all key on
-- participant_id, so a person with two differently-named blocks still owes
-- once and is chased once.

alter table blocks add column display_name text;

comment on column blocks.display_name is
  'Optional per-block name. Falls back to the owner''s alias, then full name. '
  'Display only — never a money or identity key. Cleared on release.';

-- Releasing a block drops its name with it: the number goes back to the pool
-- clean, and the prior name is preserved in the block''s history like the
-- prior holder already is.
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
      || case when (v_before ->> 'comped')::boolean then ' · was comped' else '' end
      || case when nullif(v_before ->> 'display_name', '') is not null
              then ' · block name was "' || (v_before ->> 'display_name') || '"' else '' end
      || case when nullif(v_before ->> 'notes', '') is not null
              then ' · prior note: ' || (v_before ->> 'notes') else '' end
    else nullif(v_before ->> 'notes', '')
  end;
  update blocks
     set participant_id = null, status = 'available', assignment_method = null,
         requested_ref = null, assigned_at = null, comped = false,
         display_name = null, notes = v_history
   where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before)
  values (p_actor, 'release_block', 'blocks', p_block_number::text, v_before);
end $$;

-- Set or clear a block's own name. Audited both directions.
create or replace function admin_set_block_name(
  p_block_number int,
  p_display_name text,
  p_actor text
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b blocks;
  v_new text := nullif(btrim(p_display_name), '');
begin
  perform assert_admin();
  select * into b from blocks where block_number = p_block_number for update;
  if b.block_number is null then
    raise exception 'block % does not exist', p_block_number;
  end if;
  if v_new is not null and b.participant_id is null then
    raise exception 'block % has no owner — a name belongs to a held block', p_block_number;
  end if;
  update blocks set display_name = v_new where block_number = p_block_number;
  insert into audit_log (actor, action, target_table, target_id, before, after, note)
  values (p_actor,
          case when v_new is null then 'clear_block_name' else 'set_block_name' end,
          'blocks', p_block_number::text,
          jsonb_build_object('display_name', b.display_name),
          jsonb_build_object('display_name', v_new),
          case when v_new is null
               then 'block name cleared — it falls back to the owner''s alias'
               else 'block carries its own name; the owner''s alias is unchanged' end);
end $$;

do $$
begin
  execute 'revoke execute on function admin_set_block_name(int,text,text) from public, anon';
  execute 'grant execute on function admin_set_block_name(int,text,text) to authenticated';
end $$;

-- Name resolution, block first. Column name, position and type are all
-- unchanged, so create-or-replace is happy: only the expression moves.
create or replace view v_public_blocks as
select b.block_number, b.status,
       coalesce(b.display_name, p.display_alias, p.full_name) as display_name,
       p.owner_group,
       b.participant_id,
       b.assignment_method
from blocks b left join participants p on p.id = b.participant_id;

-- A payout is announced under the name on the block that hit. "Block 65
-- hits — PRESTIGE PULLZ wins $1,000" is the whole point of a block name.
create or replace view v_public_payouts as
select
  po.id, po.game_id, po.payout_type, po.block_number, po.participant_id,
  coalesce(bl.display_name, p.display_alias, p.full_name) as display_name,
  po.amount_cents, po.created_at
from payouts po
left join participants p on p.id = po.participant_id
left join blocks bl on bl.block_number = po.block_number
where po.status <> 'void';
