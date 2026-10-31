import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import { databaseConnectionOptions } from "./database-connection.ts";

const shared = globalThis as typeof globalThis & { datokoDb?: PrismaClient; datokoPool?: Pool };
export function getPool(): Pool {
  if (shared.datokoPool) return shared.datokoPool;
  // Prisma's pg adapter serializes DateTime parameters as UTC without an
  // offset and normalizes returned timestamptz values assuming UTC. Set the
  // session timezone before the first query, independent of the host default.
  const pool = new Pool({
    ...databaseConnectionOptions(),
    // The lifecycle hook drains idle clients before Vercel suspends. Reuse
    // connections within a batch instead of repeating TLS/SCRAM for each query.
    // Pg-boss's separate, unattached pool keeps its conservative maxUses policy.
    maxUses: Infinity,
    max: 5,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    onConnect: async client => { await client.query("SET TIME ZONE 'UTC'"); },
  });
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  return shared.datokoPool = pool;
}
export function getDb(): PrismaClient {
  return shared.datokoDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
}
export async function closeDb(): Promise<void> {
  await shared.datokoDb?.$disconnect();
  await shared.datokoPool?.end();
}
