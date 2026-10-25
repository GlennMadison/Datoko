-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "variationName" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "paidAt" TIMESTAMPTZ(3),
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "variationName" TEXT;
