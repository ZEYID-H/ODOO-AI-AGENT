-- AlterTable
ALTER TABLE "User" ADD COLUMN "deliveryNotificationsSeenAt" DATETIME;

-- Historical baseline (D8): every user that already exists at migration
-- time gets their read cursor set to "now" (this migration's own execution
-- moment), not left NULL. A NULL cursor means "every derived event is
-- unread" (see the schema comment on this column) — leaving existing
-- drivers at NULL would flood them with every historical VERIFIED/
-- REJECTED/RESUBMITTED_PENDING event across the app's entire history as
-- unread the first time D8 ships. Setting the cursor to "now" instead means
-- historical events remain fully visible in the inbox (nothing is deleted
-- or hidden), but only events that occur AFTER this migration runs count
-- as unread — exactly "unread state represents events occurring after D8
-- activation." Applies to every user uniformly (OWNER rows too); harmless
-- for OWNER since the feature never reads this column for that role.
UPDATE "User" SET "deliveryNotificationsSeenAt" = CURRENT_TIMESTAMP;
