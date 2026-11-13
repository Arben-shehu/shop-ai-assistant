-- CreateEnum
CREATE TYPE "InventoryDialect" AS ENUM ('POSTGRES', 'MYSQL', 'MSSQL');

-- AlterEnum
ALTER TYPE "ChannelType" ADD VALUE 'WEB';

-- CreateTable
CREATE TABLE "InventorySource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "dialect" "InventoryDialect" NOT NULL,
    "url" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "columns" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventorySource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventorySource_organizationId_key" ON "InventorySource"("organizationId");

-- AddForeignKey
ALTER TABLE "InventorySource" ADD CONSTRAINT "InventorySource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
