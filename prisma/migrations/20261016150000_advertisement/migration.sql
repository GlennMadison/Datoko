-- CreateTable
CREATE TABLE "ad_datasets" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ad_datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_report_buckets" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "grain" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "spend" DECIMAL(20,4) NOT NULL,
    "revenue" DECIMAL(20,4) NOT NULL,
    "sourceAsOf" TIMESTAMPTZ(3) NOT NULL,
    "attributionComplete" BOOLEAN NOT NULL DEFAULT false,
    "outcomesComplete" BOOLEAN NOT NULL DEFAULT false,
    "sourceDigest" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ad_report_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_attribution_allocations" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "orderSn" TEXT NOT NULL,
    "sourceLineKey" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "disposition" TEXT NOT NULL,
    "confirmedRefund" DECIMAL(20,4) NOT NULL,
    "provisional" BOOLEAN NOT NULL,
    "returnReferences" TEXT[],

    CONSTRAINT "ad_attribution_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_report_revisions" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "sourceAsOf" TIMESTAMPTZ(3) NOT NULL,
    "importedBy" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_datasets_shopId_sourceKey_key" ON "ad_datasets"("shopId", "sourceKey");

-- CreateIndex
CREATE INDEX "ad_report_buckets_datasetId_startAt_idx" ON "ad_report_buckets"("datasetId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "ad_report_buckets_datasetId_campaignKey_grain_startAt_key" ON "ad_report_buckets"("datasetId", "campaignKey", "grain", "startAt");

-- CreateIndex
CREATE INDEX "ad_attribution_allocations_orderSn_sourceLineKey_idx" ON "ad_attribution_allocations"("orderSn", "sourceLineKey");

-- CreateIndex
CREATE UNIQUE INDEX "ad_attribution_allocations_reportId_sourceKey_key" ON "ad_attribution_allocations"("reportId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ad_report_revisions_reportId_digest_key" ON "ad_report_revisions"("reportId", "digest");

-- AddForeignKey
ALTER TABLE "ad_datasets" ADD CONSTRAINT "ad_datasets_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_report_buckets" ADD CONSTRAINT "ad_report_buckets_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ad_datasets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_attribution_allocations" ADD CONSTRAINT "ad_attribution_allocations_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ad_report_buckets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_report_revisions" ADD CONSTRAINT "ad_report_revisions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ad_report_buckets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce the financial and time invariants at the storage boundary as well.
ALTER TABLE "ad_datasets" ADD CONSTRAINT "ad_dataset_basis_check"
  CHECK ("basis" IN ('PLACED_TOTAL', 'PLACED_DIRECT', 'CONFIRMED_TOTAL', 'CONFIRMED_DIRECT'));
ALTER TABLE "ad_report_buckets" ADD CONSTRAINT "ad_report_values_check"
  CHECK ("spend" >= 0 AND "revenue" >= 0 AND "sourceAsOf" >= "startAt");
ALTER TABLE "ad_report_buckets" ADD CONSTRAINT "ad_report_grain_check"
  CHECK (("grain" = 'DAY' AND "endAt" - "startAt" = INTERVAL '1 day'
      AND ("startAt" AT TIME ZONE 'Asia/Jakarta')::time = TIME '00:00:00')
    OR ("grain" = 'HOUR' AND "endAt" - "startAt" = INTERVAL '1 hour'
      AND date_trunc('hour', "startAt") = "startAt"));
ALTER TABLE "ad_attribution_allocations" ADD CONSTRAINT "ad_allocation_values_check"
  CHECK ("amount" >= 0 AND "confirmedRefund" >= 0 AND "confirmedRefund" <= "amount"
    AND "disposition" IN ('RETAINED', 'CANCELLED', 'RETURNED'));
