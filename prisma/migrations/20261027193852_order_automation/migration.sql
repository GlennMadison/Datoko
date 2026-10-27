-- CreateTable
CREATE TABLE "order_automation" (
    "shopId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledFrom" TIMESTAMPTZ(3) NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "lastRunAt" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_automation_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "order_processing" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "checks" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "requestedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_processing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_processing_orderId_key" ON "order_processing"("orderId");

-- CreateIndex
CREATE INDEX "order_processing_shopId_status_updatedAt_idx" ON "order_processing"("shopId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "order_automation" ADD CONSTRAINT "order_automation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_processing" ADD CONSTRAINT "order_processing_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_processing" ADD CONSTRAINT "order_processing_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Server-only access through Datoko ownership checks.
ALTER TABLE "order_automation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_processing" ENABLE ROW LEVEL SECURITY;

-- Match the existing server-only role policy when hosted on Supabase.
DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'datoko_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_automation TO datoko_app';
    EXECUTE 'CREATE POLICY datoko_server_access ON public.order_automation FOR ALL TO datoko_app USING (true) WITH CHECK (true)';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_processing TO datoko_app';
    EXECUTE 'CREATE POLICY datoko_server_access ON public.order_processing FOR ALL TO datoko_app USING (true) WITH CHECK (true)';
  END IF;
END
$migration$;
