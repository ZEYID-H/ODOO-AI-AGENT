-- DropIndex
DROP INDEX "Conversation_userId_idx";

-- CreateIndex
CREATE INDEX "Conversation_userId_updatedAt_idx" ON "Conversation"("userId", "updatedAt");
