// Read-only query-statistics snapshot. Load the intended environment explicitly.
import { getPool, closeDb } from "../src/server/db.ts";

try {
  const pool = getPool();
  const { rows: reset } = await pool.query("SELECT stats_reset FROM pg_stat_statements_info");
  const { rows } = await pool.query(`SELECT queryid::text AS "queryId", calls::text, rows::text,
    round(total_exec_time::numeric, 1)::text AS "totalMs",
    CASE WHEN query ILIKE '%ad_report_revisions%' THEN 'ads revision metadata'
      WHEN query ILIKE '%financial_snapshots%' THEN 'settlements'
      WHEN query ILIKE '%order_items%' THEN 'order items'
      WHEN query ILIKE '%ad_report_buckets%' THEN 'ads buckets'
      WHEN query ILIKE '%pgboss%' THEN 'queue'
      ELSE 'other' END AS category
    FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND calls > 0 ORDER BY rows DESC LIMIT 20`);
  // No SQL text, parameters, credentials or shop/customer identifiers are emitted.
  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), statsReset: reset[0]?.stats_reset, queries: rows }, null, 2));
} catch {
  console.error("Could not read query statistics. Check the connection and permission to read pg_stat_statements.");
  process.exitCode = 1;
} finally { await closeDb(); }
