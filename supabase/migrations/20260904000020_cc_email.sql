-- A second contact on a participant.
--
-- Some blocks are held by two people. Block 1 ("nerdz") is Raychel Neil and
-- her father Ray Vassallo; block 29 ("ILM!") is Tim Flaherty and Mark Kap.
-- One participant, one $500, two people who need to hear about it. Until now
-- the second address went in notes, where nothing can chase it.
--
-- cc_email is a CONTACT DETAIL, not a second participant. It does not create
-- a row, does not add a block, does not owe anything, and never appears on a
-- public surface — email is admin-only everywhere in this schema.

alter table participants add column cc_email text;

comment on column participants.cc_email is
  'Optional second contact for the same participant — a shared block where '
  'two people both need reaching. Not a second participant: no row, no '
  'block, no money. Admin-only, like email.';

-- admin_upsert_participant gains p_cc_email. It is added WITH A DEFAULT and
-- at the end of the list on purpose: PostgREST calls RPCs with named
-- arguments, so the currently deployed app — which does not send
-- p_cc_email — keeps resolving to this function and gets null. That removes
-- the window where the database is ahead of the deploy and every admin write
-- fails. Dropping first is unavoidable: create or replace cannot add a
-- parameter, it would create an overload and make the call ambiguous.
drop function if exists admin_upsert_participant(uuid,text,text,text,text,text,text,text,text,int,text,text);

create function admin_upsert_participant(
  p_id uuid,                       -- null = create
  p_full_name text,
  p_display_alias text,
  p_email text,
  p_phone text,
  p_owner_group text,
  p_shared_group_id text,
  p_source text,
  p_source_ref text,
  p_blocks_requested int,
  p_notes text,
  p_actor text,
  p_cc_email text default null
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_id uuid := p_id;
  v_before jsonb;
begin
  perform assert_admin();
  if v_id is null then
    insert into participants (full_name, display_alias, email, cc_email, phone, owner_group,
                              shared_group_id, source, source_ref, blocks_requested, notes)
    values (p_full_name, nullif(p_display_alias, ''), nullif(p_email, ''),
            nullif(p_cc_email, ''), nullif(p_phone, ''),
            coalesce(nullif(p_owner_group, ''), 'AVD'), nullif(p_shared_group_id, ''),
            coalesce(nullif(p_source, ''), 'email'), nullif(p_source_ref, ''),
            coalesce(p_blocks_requested, 0), nullif(p_notes, ''))
    returning id into v_id;
    insert into audit_log (actor, action, target_table, target_id, after)
    values (p_actor, 'create_participant', 'participants', v_id::text,
            jsonb_build_object('full_name', p_full_name, 'alias', p_display_alias));
  else
    select to_jsonb(p) into v_before from participants p where p.id = v_id;
    if v_before is null then
      raise exception 'participant % not found', v_id;
    end if;
    update participants set
      full_name = p_full_name,
      display_alias = nullif(p_display_alias, ''),
      email = nullif(p_email, ''),
      cc_email = nullif(p_cc_email, ''),
      phone = nullif(p_phone, ''),
      owner_group = coalesce(nullif(p_owner_group, ''), 'AVD'),
      shared_group_id = nullif(p_shared_group_id, ''),
      source = coalesce(nullif(p_source, ''), 'email'),
      source_ref = nullif(p_source_ref, ''),
      blocks_requested = coalesce(p_blocks_requested, 0),
      notes = nullif(p_notes, '')
    where id = v_id;
    insert into audit_log (actor, action, target_table, target_id, before, after)
    values (p_actor, 'update_participant', 'participants', v_id::text, v_before,
            (select to_jsonb(p) from participants p where p.id = v_id));
  end if;
  return v_id;
end $$;

-- The drop took the grant with it.
do $$
begin
  execute 'grant execute on function admin_upsert_participant(uuid,text,text,text,text,text,text,text,text,int,text,text,text) to authenticated';
end $$;
