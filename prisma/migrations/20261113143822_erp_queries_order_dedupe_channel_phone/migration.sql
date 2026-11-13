-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "externalRef" TEXT;

-- AlterTable
ALTER TABLE "InventorySource" ADD COLUMN     "customerQuery" TEXT,
ADD COLUMN     "historyQuery" TEXT,
ADD COLUMN     "orderStatusQuery" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "itemsHash" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Order_customerId_itemsHash_idx" ON "Order"("customerId", "itemsHash");
