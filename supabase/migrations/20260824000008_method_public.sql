-- Assignment-policy transparency: every block shows plainly whether its
-- number was specifically requested or randomly assigned. assignment_method
-- is not private data — no email, phone, or money — so it joins the public
-- projection. (Appending a column keeps create-or-replace valid.)
create or replace view v_public_blocks as
select b.block_number, b.status,
       coalesce(p.display_alias, p.full_name) as display_name,
       p.owner_group,
       b.participant_id,
       b.assignment_method
from blocks b left join participants p on p.id = b.participant_id;
