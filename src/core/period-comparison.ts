import { dayStart, localDate, REPORT_TIMEZONE, type ReportPeriod } from "./reporting-period.ts";
const DAY = 86400000;
function monthDate(year: number, month: number, day = 1) { return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`; }
function isYearSelection(period: ReportPeriod): boolean {
  const year = Number(period.from.slice(0, 4));
  return period.from === year + "-01-01" && (period.to === period.today || period.to === year + "-12-31");
}

function comparisonName(period: ReportPeriod): string {
  if (period.preset === "year") return "Previous year";
  if (period.preset === "day") return "Previous day";
  if (period.preset === "today") return "Yesterday";
  if (period.preset === "yesterday") return "Day before yesterday";
  if (period.preset === "this-week") return "Last week";
  if (period.preset === "this-month" || (period.preset === "month" && period.to === period.today)) return "Last month";
  if (period.preset === "month-week") return "Previous week";
  if (period.preset === "month") return "Previous month";
  if (["last7", "last30", "last90"].includes(period.preset)) return "Previous " + period.preset.slice(4) + " days";
  if (isYearSelection(period)) return "Last year";
  return "Previous period";
}

/** Return the preceding like-for-like date range for metric comparisons. */
function shiftComparisonDate(value: string, days: number): string {
  return localDate(new Date(dayStart(value).getTime() + days * DAY));
}

export function comparisonReportPeriod(period: ReportPeriod): ReportPeriod {
  const startTime = dayStart(period.from).getTime();
  const endTime = dayStart(period.to).getTime();
  const duration = Math.floor((endTime - startTime) / DAY) + 1;
  let from = shiftComparisonDate(period.from, -duration);
  let to = shiftComparisonDate(period.from, -1);

  // Match year-to-date, week-to-date, and month-to-date against the
  // equivalent dates in the previous calendar period.
  if (period.preset === "year" || (period.preset === "custom" && isYearSelection(period))) {
    const previousYear = Number(period.from.slice(0, 4)) - 1;
    from = String(previousYear) + "-01-01";
    if (period.to === period.today) {
      const month = Number(period.to.slice(5, 7));
      const day = Number(period.to.slice(8, 10));
      const lastDay = new Date(Date.UTC(previousYear, month, 0)).getUTCDate();
      to = monthDate(previousYear, month, Math.min(day, lastDay));
    } else to = String(previousYear) + "-12-31";
  } else if (period.preset === "this-week" || period.preset === "month-week") {
    from = shiftComparisonDate(period.from, -7);
    to = shiftComparisonDate(period.from, -1);
    if (period.to === period.today) to = duration > 7 ? to : shiftComparisonDate(period.to, -7);
  } else if (period.preset === "this-month" || (period.preset === "month" && period.to === period.today)) {
    const currentMonth = Number(period.from.slice(5, 7));
    const previousMonthDate = new Date(Date.UTC(Number(period.from.slice(0, 4)), currentMonth - 2, 1));
    const previousYear = previousMonthDate.getUTCFullYear();
    const previousMonth = previousMonthDate.getUTCMonth() + 1;
    const previousMonthLastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
    from = monthDate(previousYear, previousMonth);
    to = monthDate(previousYear, previousMonth, Math.min(Number(period.to.slice(8, 10)), previousMonthLastDay));
  } else if (period.preset === "month" && period.from.slice(8, 10) === "01") {
    const selectedLastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
    if (Number(period.to.slice(8, 10)) === selectedLastDay) {
      const previousMonthDate = new Date(Date.UTC(period.year, period.month - 2, 1));
      const previousYear = previousMonthDate.getUTCFullYear();
      const previousMonth = previousMonthDate.getUTCMonth() + 1;
      from = monthDate(previousYear, previousMonth);
      to = monthDate(previousYear, previousMonth, new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate());
    }
  }

  if (from < "2000-01-01") {
    const boundary = dayStart("2000-01-01");
    return { ...period, preset: "custom", from: "2000-01-01", to: "2000-01-01", fromISO: boundary.toISOString(), toISO: boundary.toISOString(), effectiveToISO: boundary.toISOString(), year: 2000, month: 1, week: null, label: "No earlier period", error: null };
  }

  const start = dayStart(from);
  const inclusiveEnd = dayStart(to);
  const end = new Date(inclusiveEnd.getTime() + DAY);
  // Completed calendar periods include every day even when their lengths differ.
  // In-progress periods stop at the corresponding local date and clock time.
  const partial = Date.parse(period.effectiveToISO) < Date.parse(period.toISO) && !(period.preset === "month-week" && duration > 7);
  const timeOfDay = Date.parse(period.effectiveToISO) - dayStart(period.to).getTime();
  const effectiveEnd = partial ? new Date(Math.min(end.getTime(), inclusiveEnd.getTime() + Math.max(timeOfDay, 0))) : end;
  const format = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: REPORT_TIMEZONE }).format(date);
  const range = from === to ? format(start) : format(start) + " - " + format(inclusiveEnd);
  const cutoff = effectiveEnd.getTime() < end.getTime() ? ", through " + new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: REPORT_TIMEZONE }).format(effectiveEnd) + " WIB" : "";
  return {
    ...period,
    preset: "custom",
    from,
    to,
    fromISO: start.toISOString(),
    toISO: end.toISOString(),
    effectiveToISO: effectiveEnd.toISOString(),
    year: Number(from.slice(0, 4)),
    month: Number(from.slice(5, 7)),
    week: null,
    label: comparisonName(period) + " (" + range + cutoff + ")",
    error: null,
  };
}

export function overviewComparisonPeriod(period: ReportPeriod) { if (period.preset === "custom") return null; const previous = comparisonReportPeriod(period); return previous.label === "No earlier period" ? null : previous; }
