-- owner_group becomes admin-only on v_public_blocks.
--
-- Owner codes are how the pool's collection responsibility is split between
-- Anthony and his co-runners: which of them chases a given participant's
-- $500 and holds it. That is internal structure. It answers "who is in whose
-- book", which is a question no participant needs answered and one that
-- starts a conversation Anthony does not want to have.
--
-- It was reachable two ways, both public:
--   1. The column itself, on a definer view granted to anon. Anyone with the
--      app URL could curl the full block-to-owner map.
--   2. The /blocks board's "By owner group" colour mode and its legend,
--      which rendered the same map as a picture, with per-owner headcounts.
-- Both are closed: this migration nulls the column for non-admins, and the
-- two public surfaces that consumed it are removed in the same change.
--
-- Same pattern and same reasoning as migration 15 (due_cents) and 16
-- (collected_cents): the value stays computed and stays visible to the
-- admin; only the anon read is nulled. is_admin() reads request.jwt.claims,
-- a session GUC that SECURITY DEFINER does not touch, so the case expression
-- still sees the real caller inside a definer view.
--
-- Six columns, same order and same names. create or replace can only append,
-- and this appends nothing — one expression changes.

create or replace view v_public_blocks as
select b.block_number, b.status,
       coalesce(b.display_name, p.display_alias, p.full_name) as display_name,
       -- Collection responsibility: admin only.
       case when is_admin() then p.owner_group end as owner_group,
       b.participant_id,
       b.assignment_method
from blocks b left join participants p on p.id = b.participant_id;

comment on view v_public_blocks is
  'Public per-block projection. display_name is the name shown on the grid: '
  'the block''s own name, else the participant''s alias, else their full '
  'name. owner_group is ADMIN-ONLY (migration 18) — it is collection '
  'responsibility, not a public fact. Block numbers, statuses and names are '
  'public by design; the grid and /players are built from them.';
