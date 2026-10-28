import { AppError } from "./errors.ts";

export const REPORT_TIMEZONE = "Asia/Jakarta";
const DAY = 86_400_000;
const WIB = 7 * 3_600_000;
export const REPORT_KEYS = ["preset", "from", "to", "year", "month", "week", "interval", "tz", "days"] as const;
export const INTERVALS = ["auto", "hour", "3hour", "6hour", "12hour", "day", "week", "month"] as const;
export type ReportInterval = typeof INTERVALS[number];
export type ReportQuery = Record<string, string | string[] | undefined>;
export type ReportPeriod = {
  preset: string; from: string; to: string; fromISO: string; toISO: string; effectiveToISO: string;
  interval: ReportInterval; effectiveInterval: Exclude<ReportInterval, "auto">;
  year: number; month: number; week: number | null; today: string; label: string; error: string | null;
};
export type TimeBucket = { key: string; date: string; start: string; end: string; future: boolean };

export function localDate(value: Date): string { return new Date(value.getTime() + WIB).toISOString().slice(0, 10); }
export function dayStart(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new AppError("INVALID_REPORT_DATE", 400);
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(parsed.getTime()) || localDate(parsed) !== value || Number(value.slice(0, 4)) < 2000 || Number(value.slice(0, 4)) > 2100) throw new AppError("INVALID_REPORT_DATE", 400);
  return parsed;
}
export function shiftDate(value: string, days: number): string { return localDate(new Date(dayStart(value).getTime() + days * DAY)); }
function param(query: ReportQuery, key: string): string | undefined {
  const value = query[key];
  if (Array.isArray(value) || (value?.length ?? 0) > 100) throw new AppError("INVALID_REPORT_FILTER", 400);
  return value;
}
function integer(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,4}$/.test(value)) throw new AppError("INVALID_REPORT_FILTER", 400);
  const number = Number(value);
  if (number < min || number > max) throw new AppError("INVALID_REPORT_FILTER", 400);
  return number;
}
function monthDate(year: number, month: number, day = 1): string { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function weekStart(value: string): string {
  const weekday = new Date(dayStart(value).getTime() + WIB).getUTCDay();
  return shiftDate(value, -((weekday + 6) % 7));
}

export function resolveReportPeriod(query: ReportQuery = {}, now = new Date()): ReportPeriod {
  for (const key of REPORT_KEYS) param(query, key);
  if (query.tz !== undefined && query.tz !== REPORT_TIMEZONE) throw new AppError("INVALID_REPORT_TIMEZONE", 400);
  const today = localDate(now);
  const currentYear = Number(today.slice(0, 4));
  let year = integer(param(query, "year"), currentYear, 2000, currentYear);
  let month = integer(param(query, "month"), Number(today.slice(5, 7)), 1, 12);
  let week: number | null = null;
  const legacyDays = param(query, "days");
  const preset = param(query, "preset") ?? (["7", "30", "90"].includes(legacyDays ?? "") ? `last${legacyDays}` : "last30");
  let from: string;
  let to = today;
  switch (preset) {
    case "today": from = today; break;
    case "yesterday": from = to = shiftDate(today, -1); break;
    case "this-week": from = weekStart(today); break;
    case "this-month": from = monthDate(currentYear, Number(today.slice(5, 7))); break;
    case "last7": case "last30": case "last90": from = shiftDate(today, -Number(preset.slice(4)) + 1); break;
    case "day": from = to = param(query, "from") ?? ""; break;
    case "year": from = monthDate(year, 1); to = year === currentYear ? today : monthDate(year, 12, 31); break;
    case "month": case "month-week": {
      const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
      week = preset === "month-week" ? integer(param(query, "week"), 1, 1, 4) : null;
      from = monthDate(year, month, week === null ? 1 : (week - 1) * 7 + 1);
      to = monthDate(year, month, week === null || week === 4 ? lastDay : week * 7);
      if (from > today) throw new AppError("FUTURE_REPORT_RANGE", 400);
      if (to > today) to = today;
      break;
    }
    case "custom": from = param(query, "from") ?? ""; to = param(query, "to") ?? ""; break;
    default: throw new AppError("INVALID_REPORT_PRESET", 400);
  }
  const start = dayStart(from);
  const inclusiveEnd = dayStart(to);
  if (from > to || to > today || inclusiveEnd.getTime() - start.getTime() > 3660 * DAY) throw new AppError("INVALID_REPORT_RANGE", 400);
  if (preset === "custom" || preset === "day") { year = Number(from.slice(0, 4)); month = Number(from.slice(5, 7)); }
  const rawInterval = param(query, "interval") ?? "auto";
  if (!INTERVALS.includes(rawInterval as ReportInterval)) throw new AppError("INVALID_REPORT_INTERVAL", 400);
  const interval = rawInterval as ReportInterval;
  const days = (inclusiveEnd.getTime() - start.getTime()) / DAY + 1;
  const effectiveInterval = interval === "auto" ? days <= 2 ? "hour" : days <= 93 ? "day" : days <= 366 ? "week" : "month" : interval;
  const end = new Date(inclusiveEnd.getTime() + DAY);
  const format = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: REPORT_TIMEZONE }).format(date);
  const period: ReportPeriod = { preset, from, to, fromISO: start.toISOString(), toISO: end.toISOString(), effectiveToISO: new Date(Math.min(end.getTime(), now.getTime())).toISOString(), interval, effectiveInterval, year, month, week, today, label: `${format(start)}${from === to ? "" : ` – ${format(inclusiveEnd)}`} · WIB`, error: null };
  createTimeBuckets(period); // Reject excessive resolutions before querying data.
  return period;
}

export function pageReportPeriod(query: ReportQuery = {}, now = new Date()): ReportPeriod {
  try { return resolveReportPeriod(query, now); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { ...resolveReportPeriod({}, now), error: `${error.code.replaceAll("_", " ").toLowerCase()}. Showing the last 30 days.` };
  }
}

export function createTimeBuckets(period: ReportPeriod, maxPoints = 1000): TimeBucket[] {
  const start = new Date(period.fromISO).getTime();
  const end = new Date(period.toISO).getTime();
  const effectiveTo = new Date(period.effectiveToISO).getTime();
  const interval = period.effectiveInterval;
  const hours = { hour: 1, "3hour": 3, "6hour": 6, "12hour": 12 }[interval as "hour"];
  let cursor = start;
  const buckets: TimeBucket[] = [];
  while (cursor < end) {
    let next: number;
    if (hours) next = Math.floor((cursor + WIB) / (hours * 3_600_000)) * hours * 3_600_000 - WIB + hours * 3_600_000;
    else if (interval === "week") next = dayStart(shiftDate(weekStart(localDate(new Date(cursor))), 7)).getTime();
    else if (interval === "month") { const local = new Date(cursor + WIB); next = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - WIB; }
    else next = dayStart(shiftDate(localDate(new Date(cursor)), 1)).getTime();
    next = Math.min(next, end);
    const date = new Date(cursor);
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: REPORT_TIMEZONE, ...(hours ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const, ...(period.from === period.to ? {} : { day: "numeric" as const, month: "short" as const }) } : { day: "numeric", month: "short", year: "numeric" }) }).format(date);
    buckets.push({ key: date.toISOString(), date: label, start: date.toISOString(), end: new Date(next).toISOString(), future: cursor >= effectiveTo });
    if (buckets.length > maxPoints) throw new AppError("REPORT_TOO_MANY_POINTS", 400);
    cursor = next;
  }
  return buckets;
}

export function periodContains(period: ReportPeriod, value: string | Date): boolean {
  const time = new Date(value).getTime();
  return time >= new Date(period.fromISO).getTime() && time < new Date(period.effectiveToISO).getTime();
}
export function reportQueryString(query: ReportQuery): string {
  const result = new URLSearchParams();
  for (const key of REPORT_KEYS) if (typeof query[key] === "string") result.set(key, query[key] as string);
  return result.toString();
}
