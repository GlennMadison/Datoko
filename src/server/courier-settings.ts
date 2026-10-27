import { z } from "zod";
import { getDb } from "./db.ts";
import { getConfig, partnerConfig } from "./env.ts";
import { accessForShop, withShopLock } from "./connections.ts";
import { ShopeeClient } from "./shopee-client.ts";
import { AppError } from "../core/errors.ts";
import { courierCatalog, pickupAddresses, type CourierChannel, type PickupAddress } from "../core/courier-shipping.ts";

const id = z.string().regex(/^[1-9]\d{0,15}$/).refine(v => Number.isSafeInteger(Number(v)));
export const ruleInput = z.object({
  channelId: id, enabled: z.boolean(), method: z.enum(["dropoff", "pickup"]),
  pickupAddressId: id.nullable(), fallbackDropoff: z.boolean(),
  branchId: id.nullable(), senderRealName: z.string().trim().max(100).nullable(),
}).strict();
export const settingsInput = z.union([
  z.object({ action: z.literal("catalog") }).strict(),
  z.object({ enabled: z.boolean() }).strict(),
  z.object({ rule: ruleInput }).strict(),
]);
async function ownedShop(shopId: string, ownerId: string) {
  const shop = await getDb().shop.findFirst({ where: { id: shopId, ownerId, environment: getConfig().SHOPEE_ENV }, include: { connection: true, automation: true } });
  if (!shop) throw new AppError("SHOP_NOT_FOUND", 404);
  return shop;
}
export async function refreshCourierCatalog(shopId: string, ownerId: string) {
  return withShopLock("auto-process:" + shopId, async () => {
    const shop = await ownedShop(shopId, ownerId);
    if (shop.connection?.status !== "CONNECTED") throw new AppError("SHOPEE_RECONNECT_REQUIRED", 409);
    const client = new ShopeeClient(partnerConfig());
    const read = async (fn: (token: string, shop: string) => Promise<Record<string, unknown>>) => {
      const access = await accessForShop(shopId, shop.connection!.version);
      try { return await fn(access.accessToken, access.sourceShopId); }
      catch (e) {
        if (!(e instanceof AppError) || e.code !== "SHOPEE_ACCESS_EXPIRED") throw e;
        const next = await accessForShop(shopId, shop.connection!.version, access.accessToken);
        return fn(next.accessToken, next.sourceShopId);
      }
    };
    const channels = courierCatalog(await read((token, shop) => client.shippingChannels(token, shop)));
    // An address permission failure should still allow drop-off configuration.
    let addresses: PickupAddress[] = [], addressError: string | null = null;
    try { addresses = pickupAddresses(await read((token, shop) => client.shippingAddresses(token, shop))); }
    catch { addressError = "Could not load pickup addresses. Refresh couriers before configuring pickup."; }
    await getDb().orderAutomation.upsert({
      where: { shopId },
      create: { shopId, enabled: false, enabledFrom: new Date(), updatedBy: ownerId, channels, addresses, catalogUpdatedAt: new Date() },
      update: { channels, addresses, catalogUpdatedAt: new Date() },
    });
    return { channels, addresses, addressError };
  });
}
export async function setCourierRule(shopId: string, ownerId: string, input: z.infer<typeof ruleInput>) {
  const checked = ruleInput.safeParse(input);
  if (!checked.success) throw new AppError("INVALID_SETTING");
  return withShopLock("auto-process:" + shopId, async () => {
    const db = getDb();
    const shop = await ownedShop(shopId, ownerId);
    const rule = checked.data;
    if (rule.enabled && shop.connection?.status !== "CONNECTED") throw new AppError("SHOPEE_RECONNECT_REQUIRED", 409);
    const channels = (shop.automation?.channels ?? []) as CourierChannel[];
    const channel = channels.find(c => c.id === rule.channelId);
    if (!channel || rule.enabled && !channel.enabled) throw new AppError("COURIER_NOT_AVAILABLE", 409);
    const addresses = (shop.automation?.addresses ?? []) as PickupAddress[];
    if (rule.enabled && rule.method === "pickup" && !addresses.some(a => a.id === rule.pickupAddressId)) throw new AppError("PICKUP_ADDRESS_REQUIRED", 409);
    const current = await db.courierAutomation.findUnique({ where: { shopId_channelId: { shopId, channelId: rule.channelId } } });
    return db.courierAutomation.upsert({
      where: { shopId_channelId: { shopId, channelId: rule.channelId } },
      create: { ...rule, shopId, channelName: channel.name, enabledFrom: new Date() },
      update: { ...rule, channelName: channel.name, ...(rule.enabled && !current?.enabled ? { enabledFrom: new Date() } : {}) },
    });
  });
}
