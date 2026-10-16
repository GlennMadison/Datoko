import { createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.ts";

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomSecret = () => randomBytes(32).toString("base64url");

export function matchesHash(value: string, expected: string): boolean {
  const left = Buffer.from(digest(value), "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertSameOrigin(origin: string | null, baseUrl: string): void {
  if (!origin || origin !== new URL(baseUrl).origin) throw new AppError("INVALID_ORIGIN", 403);
}

export function safeReturnPath(path: unknown): string {
  return path === "/overview" ? path : "/settings/integrations";
}

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== key) {
    throw new AppError("INVALID_ENCRYPTION_KEY", 503);
  }
  return bytes;
}

export function encryptToken(token: string, key: string, context: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptToken(payload: string, key: string, context: string): string {
  try {
    const [version, nonce, tag, encrypted, extra] = payload.split(".");
    if (version !== "v1" || !nonce || !tag || !encrypted || extra !== undefined) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("TOKEN_DECRYPTION_FAILED", 503);
  }
}
