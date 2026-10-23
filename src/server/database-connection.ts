import { X509Certificate } from "node:crypto";
import type { PoolConfig } from "pg";
import { AppError } from "../core/errors.ts";

export function databaseConnectionOptions(): Pick<PoolConfig, "connectionString" | "ssl" | "maxUses"> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new AppError("DATABASE_NOT_CONFIGURED", 503);

  // Suspended Vercel instances cannot run pg's idle timeout. Release each
  // checked-out connection back to Supabase's session pooler immediately,
  // including pg-boss connections, instead of retaining idle server slots.
  const pooling = process.env.VERCEL === "1" ? { maxUses: 1 } : {};

  const certificate = process.env.DATABASE_SSL_CA?.replace(/\\n/g, "\n").trim();
  if (!certificate) return { connectionString, ...pooling };
  try { new X509Certificate(certificate); }
  catch { throw new AppError("INVALID_DATABASE_CERTIFICATE", 503); }

  // pg's connection-string SSL options override the explicit ssl object.
  // With a configured CA, use one verified TLS configuration for every client.
  const connection = new URL(connectionString);
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) connection.searchParams.delete(key);
  return { connectionString: connection.toString(), ssl: { ca: certificate, rejectUnauthorized: true }, ...pooling };
}
