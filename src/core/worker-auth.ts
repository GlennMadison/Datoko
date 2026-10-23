import { createHash, timingSafeEqual } from "node:crypto";

export function validWorkerAuthorization(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
