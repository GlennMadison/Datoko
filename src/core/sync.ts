import { AppError } from "./errors.ts";

export type SyncWindow = { from: Date; to: Date };

export function initialCoverageFrom(now: Date, importDays: number, historyDays: number): Date {
  // Leave room for initial retries rather than starting on the moving oldest
  // accessible second. The actual, slightly smaller coverage is shown in SQL/UI.
  const lookback = Math.min(importDays * 86_400_000, historyDays * 86_400_000 - 3_600_000);
  if (lookback <= 0) throw new AppError("INVALID_HISTORY_WINDOW");
  return new Date(now.getTime() - lookback);
}

export function syncWindows(input: { checkpoint: Date | null; coverageFrom: Date; now: Date; maxWindowDays: number; historyDays: number }): SyncWindow[] {
  if (!(input.maxWindowDays >= 1 && input.maxWindowDays <= 7)) throw new AppError("INVALID_SYNC_WINDOW");
  const end = new Date(Math.floor(input.now.getTime() / 1000) * 1000 - 60_000);
  const start = input.checkpoint ? new Date(input.checkpoint.getTime() - 300_000) : input.coverageFrom;
  if (start.getTime() < input.now.getTime() - input.historyDays * 86_400_000) throw new AppError("HISTORY_COVERAGE_GAP", 409);
  const windows: SyncWindow[] = [];
  let from = start;
  while (from < end) {
    const to = new Date(Math.min(from.getTime() + input.maxWindowDays * 86_400_000, end.getTime()));
    windows.push({ from, to });
    from = to;
  }
  return windows;
}

export interface WindowSource<T> { page: (window: SyncWindow, cursor: string | null) => Promise<{ records: T[]; nextCursor: string | null }> }
export interface WindowSink<T> { save: (record: T) => Promise<void>; commitCheckpoint: (through: Date) => Promise<void> }

export async function importWindow<T>(window: SyncWindow, source: WindowSource<T>, sink: WindowSink<T>): Promise<number> {
  let cursor: string | null = null;
  let count = 0;
  const seen = new Set<string>();
  do {
    const result = await source.page(window, cursor);
    for (const record of result.records) { await sink.save(record); count++; }
    cursor = result.nextCursor;
    if (cursor && seen.has(cursor)) throw new AppError("REPEATED_SOURCE_CURSOR", 502);
    if (cursor) seen.add(cursor);
  } while (cursor !== null);
  await sink.commitCheckpoint(window.to);
  return count;
}
