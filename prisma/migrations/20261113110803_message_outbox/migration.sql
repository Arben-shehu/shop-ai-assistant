-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'RECEIVED');

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED';

-- CreateIndex
CREATE INDEX "Message_status_nextAttemptAt_idx" ON "Message"("status", "nextAttemptAt");
