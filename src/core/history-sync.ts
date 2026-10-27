import { type SyncWindow } from "./sync.ts";

// Search the platform's lifetime; empty windows are not proof history has ended.
export const HISTORY_START = new Date("2015-01-01T00:00:00.000Z");
export const HISTORY_RESOURCE = "orders-history";

export function historyWindow(through: Date): SyncWindow | null {
  if (through <= HISTORY_START) return null;
  return { from: new Date(Math.max(HISTORY_START.getTime(), through.getTime() - 7 * 86_400_000)), to: through };
}
