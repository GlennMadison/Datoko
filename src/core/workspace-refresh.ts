export type WorkspaceStatus = { version: string; active: boolean; connected: boolean };
export function refreshDelay(active: boolean, failures = 0) {
  return Math.min(600_000, (active ? 15_000 : 120_000) * 2 ** Math.min(failures, 5));
}
export const SYNC_REQUESTED_EVENT = "datoko:sync-requested";
