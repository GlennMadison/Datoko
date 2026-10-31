import { getDb, getPool } from "./db.ts";
import { getConfig, partnerConfig } from "./env.ts";
import { getQueue, enqueueSync, transactionLock } from "./queue.ts";
import { completeAuthorization, type AuthAttempt, type CallbackInput, type TokenPair } from "../core/authorization.ts";
import { digest, randomSecret, encryptToken, decryptToken, safeReturnPath } from "../core/security.ts";
import { authorizationUrl, externalId } from "../core/shopee.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { AppError, publicErrorCode } from "../core/errors.ts";

export function authCookieName() { return getConfig().APP_BASE_URL.startsWith("https:") ? "__Host-datoko-shopee" : "datoko-shopee"; }

export async function beginConnection(actor: { ownerId: string; sessionId: string }, expectedShopId: string, returnTo: unknown) {
  const config = getConfig();
  const partner = partnerConfig();
  // Validate key material before asking the seller to authorize a one-use code.
  encryptToken("configuration-check", config.TOKEN_ENCRYPTION_KEY!, "configuration-check");
  externalId(expectedShopId);
  const allowed = config.SHOPEE_ALLOWED_SHOP_IDS.split(",").map(value => value.trim());
  if (!allowed.includes(expectedShopId)) throw new AppError("SHOP_NOT_ALLOWED", 403);
  const existing = await getDb().shop.findUnique({ where: { environment_sourceShopId: { environment: partner.environment, sourceShopId: expectedShopId } }, select: { ownerId: true } });
  if (existing && existing.ownerId !== actor.ownerId) throw new AppError("SHOP_OWNER_MISMATCH", 409);
  const state = randomSecret();
  const browserSecret = randomSecret();
  const now = new Date();
  const attempt = await getDb().$transaction(async tx => {
    await transactionLock(tx, `auth-session:${actor.sessionId}`);
    await tx.authAttempt.updateMany({ where: { ownerId: actor.ownerId, sessionHash: digest(actor.sessionId), status: "PENDING" }, data: { status: "SUPERSEDED" } });
    return tx.authAttempt.create({ data: { ownerId: actor.ownerId, sessionHash: digest(actor.sessionId), stateHash: digest(state), browserHash: digest(browserSecret), environment: partner.environment, expectedShopId, expiresAt: new Date(now.getTime() + 600_000), returnPath: safeReturnPath(returnTo) } });
  });
  const url = authorizationUrl({ ...partner, callbackUrl: config.SHOPEE_REDIRECT_URI!, state, timestamp: Math.floor(now.getTime() / 1000) });
  return { url, cookie: `${attempt.id}.${browserSecret}` };
}

export async function finishConnection(attempt: AuthAttempt, input: CallbackInput) {
  const config = getConfig();
  const client = new ShopeeClient(partnerConfig());
  const db = getDb();
  // Initialize the durable queue before consuming the provider's one-use code.
  const boss = await getQueue();
  return completeAuthorization(attempt, input, {
    claim: async (id, codeHash, now) => {
      const claimed = await db.authAttempt.updateMany({ where: { id, status: "PENDING", expiresAt: { gt: now } }, data: { status: "PROCESSING", codeHash } });
      return claimed.count === 1;
    },
    exchange: (code, shopId) => client.exchange(code, shopId),
    identify: (tokens, shopId) => client.identify(tokens, shopId),
    persist: async (attempt, tokens, identity, now) => {
      await db.$transaction(async tx => {
        await transactionLock(tx, `connection:${attempt.environment}:${identity.shopId}`);
        const previous = await tx.shop.findUnique({ where: { environment_sourceShopId: { environment: attempt.environment, sourceShopId: identity.shopId } }, include: { connection: true } });
        if (previous && previous.ownerId !== attempt.ownerId) throw new AppError("SHOP_OWNER_MISMATCH", 403);
        const sourceAttempt = await tx.authAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
        if (sourceAttempt.status !== "PROCESSING") throw new AppError("AUTH_ATTEMPT_USED");
        if (previous?.connection && previous.connection.connectedAt > sourceAttempt.createdAt) throw new AppError("NEWER_CONNECTION_EXISTS", 409);
        const shop = await tx.shop.upsert({ where: { environment_sourceShopId: { environment: attempt.environment, sourceShopId: identity.shopId } }, create: { ownerId: attempt.ownerId, sourceShopId: identity.shopId, environment: attempt.environment, name: identity.name, currency: identity.currency }, update: { name: identity.name } });
        const tokenContext = `${attempt.environment}:${identity.shopId}`;
        const credentials = { accessTokenCipher: encryptToken(tokens.accessToken, config.TOKEN_ENCRYPTION_KEY!, `${tokenContext}:access`), refreshTokenCipher: encryptToken(tokens.refreshToken, config.TOKEN_ENCRYPTION_KEY!, `${tokenContext}:refresh`), accessExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000), connectedAt: now, status: "CONNECTED", lastErrorCode: null };
        const connection = await tx.shopConnection.upsert({ where: { shopId: shop.id }, create: { shopId: shop.id, ...credentials }, update: { ...credentials, version: { increment: 1 } } });
        await tx.authAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", resultShopId: shop.id } });
        await enqueueSync(tx, boss, { shopId: shop.id, generation: connection.version, reason: "CONNECTED" });
      });
    },
    fail: async (id, code) => { await db.authAttempt.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "FAILED", errorCode: code } }); },
  });
}

export async function withShopLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const connection = await getPool().connect();
  let locked = false;
  try {
    const result = await connection.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked", [key]);
    if (!result.rows[0]?.locked) throw new AppError("SHOP_JOB_BUSY", 409);
    locked = true;
    return await action();
  } finally {
      let destroy = false;
      try { if (locked) await connection.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [key]); }
      catch (error) { destroy = true; throw error; }
      finally { connection.release(destroy); }
  }
}

export async function accessForShop(shopId: string, generation: number, failedToken?: string): Promise<{ accessToken: string; sourceShopId: string }> {
  return withShopLock(`refresh:${shopId}`, async () => {
    const db = getDb();
    const config = getConfig();
    const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, include: { connection: true } });
    const connection = shop.connection;
    if (!connection || connection.status !== "CONNECTED" || connection.version !== generation || shop.environment !== config.SHOPEE_ENV) throw new AppError("CONNECTION_CHANGED", 409);
    if (!connection.accessTokenCipher || !connection.refreshTokenCipher || !connection.accessExpiresAt) throw new AppError("SHOPEE_RECONNECT_REQUIRED", 401);
    const context = `${shop.environment}:${shop.sourceShopId}`;
    const currentToken = decryptToken(connection.accessTokenCipher, config.TOKEN_ENCRYPTION_KEY!, `${context}:access`);
    const due = connection.accessExpiresAt.getTime() < Date.now() + 600_000;
    if ((!failedToken && !due) || (failedToken && currentToken !== failedToken && !due)) return { accessToken: currentToken, sourceShopId: shop.sourceShopId };
    let tokens: TokenPair;
    try {
      const refresh = decryptToken(connection.refreshTokenCipher, config.TOKEN_ENCRYPTION_KEY!, `${context}:refresh`);
      tokens = await new ShopeeClient(partnerConfig()).refresh(refresh, shop.sourceShopId);
    } catch (error) {
      // A network failure can have consumed a rotating refresh token. Reconnection
      // is safer than repeated attempts with an unknown credential generation.
      await db.shopConnection.updateMany({ where: { id: connection.id, version: generation }, data: { status: "RECONNECT_REQUIRED", lastErrorCode: publicErrorCode(error) } });
      throw error;
    }
    const updated = await db.shopConnection.updateMany({ where: { id: connection.id, version: generation, status: "CONNECTED", refreshTokenCipher: connection.refreshTokenCipher }, data: {
      accessTokenCipher: encryptToken(tokens.accessToken, config.TOKEN_ENCRYPTION_KEY!, `${context}:access`),
      refreshTokenCipher: encryptToken(tokens.refreshToken, config.TOKEN_ENCRYPTION_KEY!, `${context}:refresh`),
      accessExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000), lastErrorCode: null,
    } });
    if (updated.count !== 1) throw new AppError("CONNECTION_CHANGED", 409);
    return { accessToken: tokens.accessToken, sourceShopId: shop.sourceShopId };
  });
}

export async function disconnectShop(shopId: string, ownerId: string): Promise<void> {
  const db = getDb();
  await db.$transaction(async tx => {
    const shop = await tx.shop.findFirst({ where: { id: shopId, ownerId } });
    if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
    // The same lock is used by callback persistence; a finishing callback
    // cannot silently undo an explicit disconnect.
    await transactionLock(tx, `connection:${shop.environment}:${shop.sourceShopId}`);
    await tx.shopConnection.update({ where: { shopId }, data: { status: "DISCONNECTED", version: { increment: 1 }, accessTokenCipher: null, refreshTokenCipher: null, accessExpiresAt: null, refreshExpiresAt: null } });
    await tx.syncRun.updateMany({ where: { shopId, status: { in: ["QUEUED", "RUNNING", "RETRYING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
    await tx.authAttempt.updateMany({ where: { ownerId, expectedShopId: shop.sourceShopId, environment: shop.environment, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELLED" } });
  });
}
