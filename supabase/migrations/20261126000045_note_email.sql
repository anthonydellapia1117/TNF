-- Migration 45: the note email (Anthony, 2026-11-26 12:41 PM ET, Part S).
--
-- Mark/Santos paid Ron in September and were never put on the board. Anthony
-- gave them his blocks 3 and 23 at 12:41 PM ET on Nov 26 and asked for one
-- email to Mark, in his words, with that day's grid pictures. Nothing came in
-- from Mark, so answer_<id> (a reply to an inbound message) does not fit, and
-- no other per-recipient family carries pictures.
--
-- note_<YYYY-MM-DD>_<name>: per recipient, claimed in email_sends through
-- admin_email_claim like every per-recipient send.
--   admin_email_recipients: a holder's own address only (email_holder_addresses
--     via 'primary'), never a cc, never Anthony's own.
--   admin_email_context: refuses any other address; carries people (the
--     greeting rule), holder (the blocks the note may name) and the key
--     date's day facts (pictures only of published, verified games).
-- Both functions are migration 43's, verbatim, with the note branch added.
-- Same signatures, so the grants stand.

create or replace function admin_email_recipients(p_event_key text)
returns table (recipient text)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform assert_admin();

  if p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    -- The game-day emails (migration 43): Anthony, RM and MAP, and the
    -- plan's Bcc, each holder's own address.
    return query
      select lower(btrim(o.email)) from owners o
       where o.code in ('AVD', 'RM', 'MAP') and nullif(btrim(o.email), '') is not null
      union
      select a.address from email_day_addresses() a
       where not a.on_envelope and a.excluded is null
      order by 1;

  elsif p_event_key ~ '^recruit_broadcast_\d{4}-\d{2}-\d{2}$' then
    return query
      select lower(btrim(o.email)) from owners o where nullif(btrim(o.email), '') is not null
      union
      select a.address from email_recruit_broadcast_addresses() a
       where not a.on_to and a.excluded is null
      order by 1;

  elsif p_event_key ~ '^format_change_\d{4}-\d{2}-\d{2}$' then
    return query
      select lower(btrim(o.email)) from owners o where nullif(btrim(o.email), '') is not null
      union
      select a.address from email_format_change_addresses() a
       where not a.on_to and a.excluded is null
      order by 1;

  elsif p_event_key like 'holder\_checkin\_%' or p_event_key like 'game\_day\_%' then
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.recipient not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'recruit\_%' then
    return query
      select p.email
        from prospects p
       where p.excluded_at is null
         and p.email not in (select h.recipient from email_holder_addresses() h)
         and p.email not in (select email_owner_addresses())
         and p.email not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key like 'reply\_%' then
    return query
      select distinct a.addr
        from participants p,
             unnest(array[lower(btrim(p.email)), lower(btrim(p.cc_email))]) as a(addr)
       where nullif(a.addr, '') is not null
         and a.addr not in (select email_avd_addresses())
       order by 1;

  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    return query
      select a.a from email_pool_addresses() a(a) order by 1;

  elsif p_event_key ~ '^note_\d{4}-\d{2}-\d{2}_[a-z0-9]+(-[a-z0-9]+)*$' then
    -- Part S (migration 45): a note from Anthony to one holder, at the
    -- holder's own address. Never a cc (it can be another person), never
    -- Anthony's own.
    return query
      select distinct h.recipient
        from email_holder_addresses() h
       where h.via = 'primary'
         and h.recipient not in (select email_avd_addresses())
       order by 1;

  else
    raise exception 'no recipient rule for event %', p_event_key;
  end if;
end $$;

create or replace function admin_email_context(p_event_key text, p_recipient text)
returns jsonb
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_r text := lower(btrim(coalesce(p_recipient, '')));
  v_out jsonb;
  v_holder jsonb;
begin
  perform assert_admin();
  v_out := jsonb_build_object('event_key', p_event_key,
                              'recipient', v_r,
                              'common', email_common_facts());

  if p_event_key like 'holder\_checkin\_%' then
    v_holder := email_holder_facts(v_r);
    if jsonb_array_length(v_holder -> 'blocks') = 0 then
      raise exception '% holds no committed block; a holder check-in for it would state something false', v_r;
    end if;
    v_out := v_out || jsonb_build_object('holder', v_holder);
  elsif p_event_key like 'digest\_%' then
    v_out := v_out || jsonb_build_object('digest', email_digest_facts());
  elsif p_event_key like 'reply\_%' then
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not on a participant row; the sweep files the sender before it replies', v_r;
    end if;
    v_out := v_out || jsonb_build_object('blocks', (
      select jsonb_agg(jsonb_build_object('block_number', b.block_number, 'status', b.status)
                       order by b.block_number)
        from blocks b));
  elsif p_event_key ~ '^(game_list|answer)_[0-9a-f]+$' then
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not a participant, prospect or owner address; file the sender before replying', v_r;
    end if;
    v_out := v_out || jsonb_build_object('people', email_people_for(v_r));
  elsif p_event_key ~ '^(kickoff|gameday|winners)_\d{4}-\d{2}-\d{2}$' then
    v_out := v_out || jsonb_build_object('day', email_day_facts(substring(p_event_key from '(\d{4}-\d{2}-\d{2})$')::date));
  elsif p_event_key ~ '^note_\d{4}-\d{2}-\d{2}_[a-z0-9]+(-[a-z0-9]+)*$' then
    -- Part S (migration 45): who the address reaches, the blocks they hold
    -- (a block the note names must be one of them) and the key date's games
    -- (a picture only of a game whose digits are published).
    if not exists (select 1 from admin_email_recipients(p_event_key) r where r.recipient = v_r) then
      raise exception '% is not a holder''s own address; a note goes only to a holder', v_r;
    end if;
    v_out := v_out || jsonb_build_object(
      'people', email_people_for(v_r),
      'holder', email_holder_facts(v_r),
      'day', email_day_facts(substring(p_event_key from '^note_(\d{4}-\d{2}-\d{2})_')::date));
  end if;

  return v_out;
end $$;
