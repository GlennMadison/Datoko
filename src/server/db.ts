import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { Pool } from "pg";
import { AppError } from "../core/errors.ts";

const shared = globalThis as typeof globalThis & { datokoDb?: PrismaClient; datokoPool?: Pool };
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new AppError("DATABASE_NOT_CONFIGURED", 503);
  if (shared.datokoPool) return shared.datokoPool;
  // Prisma's pg adapter serializes DateTime parameters as UTC without an
  // offset and normalizes returned timestamptz values assuming UTC. Set the
  // session timezone before the first query, independent of the host default.
  const connection = new URL(process.env.DATABASE_URL);
  const options = connection.searchParams.get("options");
  connection.searchParams.set("options", `${options ? `${options} ` : ""}-c timezone=UTC`);
  return shared.datokoPool = new Pool({ connectionString: connection.toString(), max: 5, connectionTimeoutMillis: 5000 });
}
export function getDb(): PrismaClient {
  return shared.datokoDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
}
export async function closeDb(): Promise<void> {
  await shared.datokoDb?.$disconnect();
  await shared.datokoPool?.end();
}
