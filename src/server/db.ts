import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";
import { Pool } from "pg";
import { AppError } from "../core/errors.ts";

const shared = globalThis as typeof globalThis & { datokoDb?: PrismaClient; datokoPool?: Pool };
export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new AppError("DATABASE_NOT_CONFIGURED", 503);
  return shared.datokoPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
}
export function getDb(): PrismaClient {
  return shared.datokoDb ??= new PrismaClient({ adapter: new PrismaPg(getPool()) });
}
export async function closeDb(): Promise<void> {
  await shared.datokoDb?.$disconnect();
  await shared.datokoPool?.end();
}
