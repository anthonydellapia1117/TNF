-- Migration 45: the note email (Anthony, 2026-11-26 12:41 PM ET, Part S).
--
-- note_<YYYY-MM-DD>_<name> goes to one holder's own address and nobody else:
-- never a cc (it can be another person), never Anthony's own, never an
-- owner's alt, never a blocked address, never a prospect or a participant
-- with no committed block. Its context carries the blocks of the
-- participants whose OWN address it is (never a block reached through someone
-- else's cc) and the key date's games, and refuses any other address. One
-- note key goes to one recipient.
--
-- One transaction, rolled back. Every expected refusal checks its error text.
-- Fixture addresses use the reserved tnf.test domain only.
--
-- Mutation checks, each verified to fail: let a cc through (recipients from
-- every holder address); let Anthony's own through (avd filter dropped); let
-- an owner's alt or a blocked address through (exclusions dropped); drop the
-- context refusal; drop the holder or day facts from the context; reach
-- holder facts through a cc (via filter dropped); drop the one-note-per-key
-- index; widen the key to an upper-case name.

begin;

select set_config('request.jwt.claims', '{"email":"anthonydellapia@gmail.com"}', true);
update owners set email = 'avd-primary@tnf.test', alt_email = 'avd-work@tnf.test' where code = 'AVD';
update owners set alt_email = 'map-alt@tnf.test' where code = 'MAP';

create temp table t_n (k text, v uuid, b int[]);

do $$
declare
  v_open int[];
  v_jane uuid; v_self uuid; v_nora uuid; v_ray uuid; v_alt uuid; v_blk uuid;
begin
  select array_agg(block_number) into v_open
    from (select block_number from blocks where status = 'available' order by block_number limit 6) s;
  if v_open is null or cardinality(v_open) < 6 then
    raise exception 'TEST SETUP: need 6 available blocks, found %', coalesce(cardinality(v_open), 0);
  end if;

  insert into participants (full_name, display_alias, email, cc_email, owner_group, source, blocks_requested)
  values ('Jane Holder', 'JH', '  Jane@TNF.test ', 'jane-cc@tnf.test', 'RM', 'text', 2)
  returning id into v_jane;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Anthony Fixture', 'AF', 'avd-primary@tnf.test', 'AVD', 'email', 1) returning id into v_self;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Nora Nobody', 'NN', 'nora@tnf.test', 'AVD', 'email', 0) returning id into v_nora;
  insert into prospects (email, source_ref) values ('prospect@tnf.test', 'suite 33');

  -- Ray: his own address, and Jane's address as his cc (the nerdz shape).
  insert into participants (full_name, display_alias, email, cc_email, owner_group, source, blocks_requested)
  values ('Ray Cc', 'RC', 'ray@tnf.test', 'jane@tnf.test', 'JPOD', 'text', 1) returning id into v_ray;
  -- A holder whose own address is MAP's alt, and one whose address is blocked.
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Alt Holder', 'AH', 'map-alt@tnf.test', 'MAP', 'text', 1) returning id into v_alt;
  insert into participants (full_name, display_alias, email, owner_group, source, blocks_requested)
  values ('Blocked Holder', 'BH', 'blocked@tnf.test', 'RM', 'text', 1) returning id into v_blk;
  insert into blocked_address_hashes (hash, reason) values (address_hash('blocked@tnf.test'), 'suite 33');

  update blocks set participant_id = v_jane, status = 'assigned', assignment_method = 'admin' where block_number in (v_open[1], v_open[2]);
  update blocks set participant_id = v_self, status = 'reserved', assignment_method = 'admin' where block_number = v_open[3];
  update blocks set participant_id = v_ray,  status = 'assigned', assignment_method = 'admin' where block_number = v_open[4];
  update blocks set participant_id = v_alt,  status = 'assigned', assignment_method = 'admin' where block_number = v_open[5];
  update blocks set participant_id = v_blk,  status = 'assigned', assignment_method = 'admin' where block_number = v_open[6];
  insert into t_n values ('jane', v_jane, array[v_open[1], v_open[2]]), ('ray', v_ray, array[v_open[4]]);
end $$;

-- 1. Recipients: Jane's own address, and nothing else this suite made.
do $$
declare
  k text := 'note_2026-11-26_jane';
  r text[];
begin
  select array_agg(recipient) into r from admin_email_recipients(k);
  if r is null then
    raise exception 'TEST FAILURE: % has no recipients at all', k;
  end if;
  if not ('jane@tnf.test' = any (r)) then
    raise exception 'TEST FAILURE: the holder''s own address is not a recipient of %', k;
  end if;
  if 'jane-cc@tnf.test' = any (r) then
    raise exception 'TEST FAILURE: a cc address is a recipient of %', k;
  end if;
  if 'avd-primary@tnf.test' = any (r) then
    raise exception 'TEST FAILURE: Anthony''s own address is a recipient of %', k;
  end if;
  if 'nora@tnf.test' = any (r) or 'prospect@tnf.test' = any (r) then
    raise exception 'TEST FAILURE: a non-holder is a recipient of %', k;
  end if;
  if 'map-alt@tnf.test' = any (r) then
    raise exception 'TEST FAILURE: an owner''s alt address is a recipient of %', k;
  end if;
  if 'blocked@tnf.test' = any (r) then
    raise exception 'TEST FAILURE: a blocked address is a recipient of %', k;
  end if;
  if not ('ray@tnf.test' = any (r)) then
    raise exception 'TEST FAILURE: Ray''s own address is not a recipient of %', k;
  end if;
  if exists (select 1 from unnest(r) a where a not in (select h.recipient from email_holder_addresses() h where h.via = 'primary')) then
    raise exception 'TEST FAILURE: a recipient of % is not a holder''s own address', k;
  end if;
end $$;

-- 2. The key: lower-case name, hyphens between words, nothing else.
do $$
declare
  k text;
begin
  foreach k in array array['note_2026-11-26_Jane', 'note_2026-11-26_jane_doe', 'note_2026-11-26_', 'note_2026-11-26_jane-', 'note_jane', 'note_2026-11-26_jane@tnf.test'] loop
    begin
      perform admin_email_recipients(k);
      raise exception 'TEST FAILURE: % has a recipient rule', k;
    exception when others then
      if sqlerrm not like 'no recipient rule for event %' then
        raise exception 'TEST FAILURE: % refused for the wrong reason: %', k, sqlerrm;
      end if;
    end;
  end loop;
  perform admin_email_recipients('note_2026-11-26_jane-doe');
end $$;

-- 3. The context: people, the holder's blocks and the key date's games; any
--    other address refused.
do $$
declare
  c jsonb;
  want int[] := (select b from t_n where k = 'jane');
  got int[];
  a text;
begin
  c := admin_email_context('note_2026-11-26_jane', 'JANE@tnf.test');
  -- Jane's address is also Ray's cc: the note context is Jane alone, and
  -- Ray's block is not hers.
  if c -> 'people' is null or jsonb_array_length(c -> 'people') <> 1
     or c -> 'people' -> 0 ->> 'full_name' is distinct from 'Jane Holder' then
    raise exception 'TEST FAILURE: note context people is %', coalesce((c -> 'people')::text, 'NULL');
  end if;
  if c -> 'holder' is null then
    raise exception 'TEST FAILURE: note context has no holder facts';
  end if;
  select array_agg((x ->> 'block_number')::int order by (x ->> 'block_number')::int) into got
    from jsonb_array_elements(c -> 'holder' -> 'blocks') x;
  if got is distinct from want then
    raise exception 'TEST FAILURE: note context blocks %, want %', got, want;
  end if;
  if c -> 'day' is null or c -> 'day' ->> 'date' is distinct from '2026-11-26' then
    raise exception 'TEST FAILURE: note context day is %', coalesce((c -> 'day')::text, 'NULL');
  end if;

  foreach a in array array['jane-cc@tnf.test', 'avd-primary@tnf.test', 'nora@tnf.test', 'prospect@tnf.test', 'nobody@tnf.test', 'map-alt@tnf.test', 'blocked@tnf.test'] loop
    begin
      perform admin_email_context('note_2026-11-26_jane', a);
      raise exception 'TEST FAILURE: a note context was built for %', a;
    exception when others then
      if sqlerrm not like '% is not a holder''s own address; a note goes only to a holder' then
        raise exception 'TEST FAILURE: note context for % refused for the wrong reason: %', a, sqlerrm;
      end if;
    end;
  end loop;
end $$;

-- 4. The claim: Jane once, nobody else under her key, never twice.
do $$
declare
  k text := 'note_2026-11-26_jane';
  sha text := repeat('a', 64);
  id uuid;
begin
  id := admin_email_claim(k, 'jane@tnf.test', sha, 'suite 33');
  if id is null then
    raise exception 'TEST FAILURE: the note claim returned NULL';
  end if;
  begin
    perform admin_email_claim(k, 'jane@tnf.test', sha, 'suite 33');
    raise exception 'TEST FAILURE: the same note claimed twice';
  exception when others then
    if sqlerrm not like 'already claimed and NOT confirmed sent%' then
      raise exception 'TEST FAILURE: second claim refused for the wrong reason: %', sqlerrm;
    end if;
  end;
  -- A second holder under the same key: the one-note-per-key index refuses.
  begin
    perform admin_email_claim(k, 'ray@tnf.test', sha, 'suite 33');
    raise exception 'TEST FAILURE: one note key claimed for a second holder';
  exception when others then
    if sqlerrm not like '%email_sends_one_note_per_key%' then
      raise exception 'TEST FAILURE: second-holder claim refused for the wrong reason: %', sqlerrm;
    end if;
  end;
  -- Ray under his own key is fine.
  if admin_email_claim('note_2026-11-26_ray', 'ray@tnf.test', sha, 'suite 33') is null then
    raise exception 'TEST FAILURE: Ray''s own note claim returned NULL';
  end if;
  begin
    perform admin_email_claim(k, 'jane-cc@tnf.test', sha, 'suite 33');
    raise exception 'TEST FAILURE: a note claimed for a cc';
  exception when others then
    if sqlerrm not like 'refused: % is not a derived recipient of %' then
      raise exception 'TEST FAILURE: cc claim refused for the wrong reason: %', sqlerrm;
    end if;
  end;
end $$;

-- 5. Every other key's rule is unchanged: an answer still reaches a prospect,
--    and the game-day emails still answer.
do $$
begin
  if not exists (select 1 from admin_email_recipients('answer_1a2b') r where r.recipient = 'prospect@tnf.test') then
    raise exception 'TEST FAILURE: answer_ lost a prospect recipient';
  end if;
  perform admin_email_recipients('gameday_2026-11-26');
  perform admin_email_context('gameday_2026-11-26', 'avd-primary@tnf.test');
end $$;

rollback;
