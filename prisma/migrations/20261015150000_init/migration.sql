-- Initial Datoko schema. Prepared offline; validate on a test PostgreSQL instance.

CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sourceShopId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_connections" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "accessTokenCipher" TEXT,
    "refreshTokenCipher" TEXT,
    "accessExpiresAt" TIMESTAMPTZ(3),
    "refreshExpiresAt" TIMESTAMPTZ(3),
    "connectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastErrorCode" TEXT,
    CONSTRAINT "shop_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_attempts" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionHash" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "expectedShopId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "returnPath" TEXT NOT NULL DEFAULT '/settings/integrations',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "codeHash" TEXT,
    "resultShopId" TEXT,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "auth_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "sourceModelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sku_cost_versions" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "sku_cost_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderSn" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "totalAmount" DECIMAL(20,4) NOT NULL,
    "merchandiseAmount" DECIMAL(20,4) NOT NULL,
    "sourceCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSyncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sourceLineKey" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "originalUnitPrice" DECIMAL(20,4) NOT NULL,
    "paidUnitPrice" DECIMAL(20,4) NOT NULL,
    "costSnapshot" DECIMAL(20,4),
    "costVersionId" TEXT,
    "costQuality" TEXT NOT NULL DEFAULT 'MISSING',
    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "order_history" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "previousStatus" TEXT,
    "status" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "return_cases" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "returnSn" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reportedAmount" DECIMAL(20,4),
    "confirmedRefund" DECIMAL(20,4),
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "return_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financial_snapshots" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "amounts" JSONB NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "financial_entries" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "financial_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_states" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "checkpoint" TIMESTAMPTZ(3),
    "coverageFrom" TIMESTAMPTZ(3),
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastErrorCode" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "sync_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_runs" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "jobId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "generation" INTEGER NOT NULL,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE UNIQUE INDEX "accounts_providerId_accountId_key" ON "accounts"("providerId", "accountId");
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");
CREATE UNIQUE INDEX "shops_environment_sourceShopId_key" ON "shops"("environment", "sourceShopId");
CREATE INDEX "shops_ownerId_idx" ON "shops"("ownerId");
CREATE UNIQUE INDEX "shop_connections_shopId_key" ON "shop_connections"("shopId");
CREATE UNIQUE INDEX "auth_attempts_stateHash_key" ON "auth_attempts"("stateHash");
CREATE UNIQUE INDEX "auth_attempts_codeHash_key" ON "auth_attempts"("codeHash");
CREATE INDEX "auth_attempts_ownerId_sessionHash_status_idx" ON "auth_attempts"("ownerId", "sessionHash", "status");
CREATE UNIQUE INDEX "product_variants_shopId_sourceItemId_sourceModelId_key" ON "product_variants"("shopId", "sourceItemId", "sourceModelId");
CREATE INDEX "product_variants_shopId_sku_idx" ON "product_variants"("shopId", "sku");
CREATE INDEX "sku_cost_versions_variantId_effectiveAt_idx" ON "sku_cost_versions"("variantId", "effectiveAt");
CREATE UNIQUE INDEX "orders_shopId_orderSn_key" ON "orders"("shopId", "orderSn");
CREATE INDEX "orders_shopId_sourceCreatedAt_idx" ON "orders"("shopId", "sourceCreatedAt");
CREATE INDEX "orders_shopId_status_idx" ON "orders"("shopId", "status");
CREATE UNIQUE INDEX "order_items_orderId_sourceLineKey_key" ON "order_items"("orderId", "sourceLineKey");
CREATE INDEX "order_history_orderId_observedAt_idx" ON "order_history"("orderId", "observedAt");
CREATE UNIQUE INDEX "return_cases_shopId_returnSn_key" ON "return_cases"("shopId", "returnSn");
CREATE INDEX "return_cases_shopId_status_idx" ON "return_cases"("shopId", "status");
CREATE UNIQUE INDEX "financial_snapshots_orderId_source_revision_key" ON "financial_snapshots"("orderId", "source", "revision");
CREATE UNIQUE INDEX "financial_entries_orderId_source_dedupeKey_key" ON "financial_entries"("orderId", "source", "dedupeKey");
CREATE UNIQUE INDEX "sync_states_shopId_resource_key" ON "sync_states"("shopId", "resource");
CREATE UNIQUE INDEX "sync_runs_jobId_key" ON "sync_runs"("jobId");
CREATE INDEX "sync_runs_shopId_status_idx" ON "sync_runs"("shopId", "status");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shops" ADD CONSTRAINT "shops_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shop_connections" ADD CONSTRAINT "shop_connections_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "auth_attempts" ADD CONSTRAINT "auth_attempts_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_cost_versions" ADD CONSTRAINT "sku_cost_versions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "orders" ADD CONSTRAINT "orders_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_snapshots" ADD CONSTRAINT "financial_snapshots_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_entries" ADD CONSTRAINT "financial_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "shops" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
