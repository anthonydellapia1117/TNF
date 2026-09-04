-- BG joins the owner codes. Billy Guyon is an owner, the same as AVD, MAP,
-- RM and JPOD: he collects from his own participants and holds that cash.
--
-- This is an addition, not a rename. Nothing moves between codes here — the
-- constraint simply stops rejecting 'BG'. Reassignments are separate,
-- deliberate calls Anthony makes participant by participant.
--
-- Why it matters rather than being cosmetic: until now a participant Billy
-- collects from had to be filed under one of the seven, which attributed his
-- money to an owner who never touched it. That is wrong in two books at once
-- and would have surfaced at season-end reconciliation as a shortfall for the
-- holder of record and a surplus for Billy. Marc Massimino is the live case:
-- he asked on Aug 18 2026 about paying through Billy and there was nowhere
-- correct to record the answer.
--
-- Valid codes become: AVD, MAP, RM, JPOD, EJD, NL, GD, BG.

alter table participants drop constraint participants_owner_group_check;
alter table participants add constraint participants_owner_group_check
  check (owner_group in ('AVD','MAP','RM','JPOD','EJD','NL','GD','BG'));

comment on column participants.owner_group is
  'Which owner collects this participant''s $500 and holds it — collection '
  'responsibility, not provenance. One of AVD, MAP, RM, JPOD, EJD, NL, GD, '
  'BG. BG (Billy Guyon) added 2026-09-04 by migration 19. DIRECT was retired '
  '2026-08-28 by migration 13 and folded into AVD.';
