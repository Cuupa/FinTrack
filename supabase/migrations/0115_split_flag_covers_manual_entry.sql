-- The `splitDetection` flag now also gates the manual SPLIT entry in the
-- transaction form, not just the automatic detection on the asset detail page.
--
-- One feature, one flag: a user who cannot be told about a split has no use for
-- the entry mask either, and a second flag for the same thing is the fork this
-- codebase keeps closing. Nothing changes for existing databases beyond the
-- description the admin flag list shows -- the flag stays enabled, so the
-- button stays where it is until the owner turns it off.

update public.feature_flags
set description = 'Share splits: automatic detection + review on asset detail, and the manual SPLIT entry in the transaction form'
where flag = 'splitDetection';
