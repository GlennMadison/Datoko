-- CreateTable
CREATE TABLE "auth_rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_rate_limits_key_key" ON "auth_rate_limits"("key");

-- CreateIndex
CREATE INDEX "auth_rate_limits_lastRequest_idx" ON "auth_rate_limits"("lastRequest");

-- Only the application server may access authentication rate-limit counters.
ALTER TABLE "public"."auth_rate_limits" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "public"."auth_rate_limits" FROM PUBLIC;
DO $access$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."auth_rate_limits" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."auth_rate_limits" FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'datoko_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."auth_rate_limits" TO datoko_app;
    CREATE POLICY auth_rate_limits_server_access ON "public"."auth_rate_limits"
      TO datoko_app USING (true) WITH CHECK (true);
  END IF;
END;
$access$;
