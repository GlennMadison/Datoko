ALTER TABLE "order_automation" ADD COLUMN "channels" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "addresses" JSONB NOT NULL DEFAULT '[]', ADD COLUMN "catalogUpdatedAt" TIMESTAMPTZ(3);
ALTER TABLE "order_processing" ADD COLUMN "channelId" TEXT, ADD COLUMN "method" TEXT;
UPDATE "order_automation" SET "enabled" = false;
CREATE TABLE "courier_automation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "shopId" TEXT NOT NULL REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "channelId" TEXT NOT NULL,
  "channelName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledFrom" TIMESTAMPTZ(3) NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'dropoff',
  "pickupAddressId" TEXT,
  "fallbackDropoff" BOOLEAN NOT NULL DEFAULT false,
  "branchId" TEXT,
  "senderRealName" TEXT,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "courier_automation_method_check" CHECK ("method" IN ('pickup', 'dropoff'))
);
CREATE UNIQUE INDEX "courier_automation_shopId_channelId_key" ON "courier_automation"("shopId", "channelId");

ALTER TABLE "courier_automation" ENABLE ROW LEVEL SECURITY;

-- Match the existing server-only role policy when hosted on Supabase.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'datoko_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_automation TO datoko_app';
    EXECUTE 'CREATE POLICY datoko_server_access ON public.courier_automation FOR ALL TO datoko_app USING (true) WITH CHECK (true)';
  END IF;
END
$migration$;
