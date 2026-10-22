import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { Pool } from "pg";
import { databaseConnectionOptions } from "./database-connection.ts";

const shared = globalThis as typeof globalThis & { datokoDb?: PrismaClient; datokoPool?: Pool };
export function getPool(): Pool {
  if (shared.datokoPool) return shared.datokoPool;
  // Prisma's pg adapter serializes DateTime parameters as UTC without an
  // offset and normalizes returned timestamptz values assuming UTC. Set the
  // session timezone before the first query, independent of the host default.
  return shared.datokoPool = new Pool({
    ...databaseConnectionOptions(),
    max: 5,
    connectionTimeoutMillis: 5000,
    onConnect: async client => { await client.query("SET TIME ZONE 'UTC'"); },
  });
}
export function getDb(): PrismaClient {
  return shared.datokoDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
}
export async function closeDb(): Promise<void> {
  await shared.datokoDb?.$disconnect();
  await shared.datokoPool?.end();
}
