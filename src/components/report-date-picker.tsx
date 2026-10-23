"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { dayStart, resolveReportPeriod, type ReportPeriod } from "@/core/reporting-period";
import { useReportNavigation } from "./report-navigation";

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortcuts = [["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"]];
const views = [["day", "By day"], ["week", "By week"], ["month", "By month"], ["year", "By year"], ["custom", "Custom range"]] as const;
type View = typeof views[number][0];
const dateKey = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function selectionTitle(period: ReportPeriod) {
  const shortcut = shortcuts.find(([key]) => key === period.preset)?.[1];
  if (shortcut) return shortcut;
  if (period.preset === "this-week") return "This week";
  if (period.preset === "this-month") return "This month";
  if (period.week) return `Week ${period.week} · ${months[period.month - 1].slice(0, 3)} ${period.year}`;
  if (period.preset === "month") return `${months[period.month - 1]} ${period.year}`;
  if (period.from === period.to) return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(dayStart(period.from));
  if (period.from === `${period.year}-01-01` && period.to === (period.year === Number(period.today.slice(0, 4)) ? period.today : `${period.year}-12-31`)) return String(period.year);
  return "Custom range";
}

export function ReportDatePicker({ period, onSelect }: { period: ReportPeriod; onSelect: (patch: Record<string, string>) => boolean }) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { getQuery } = useReportNavigation();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("day");
  const [year, setYear] = useState(period.year);
  const [month, setMonth] = useState(period.month);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const currentYear = Number(period.today.slice(0, 4));
  const years = Array.from({ length: currentYear - 1999 }, (_, index) => currentYear - index);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

  useEffect(() => { setFrom(period.from); setTo(period.to); setDirty(false); setError(""); }, [period.from, period.to, period.preset]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      const height = popup.current?.getBoundingClientRect().height;
      if (!rect || !height) return;
      const width = Math.min(480, window.innerWidth - 32);
      setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: rect.bottom + 8 + height <= window.innerHeight - 16 ? rect.bottom + 8 : Math.max(16, rect.top - height - 8) });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place); };
  }, [open, view, year, month, period.from, period.to]);
  useEffect(() => {
    if (!dirty || view !== "custom") return;
    if (!from || !to) { setError("Choose both dates."); return; }
    try { dayStart(from); dayStart(to); if (from > to || to > period.today) throw new Error(); }
    catch { setError("Choose a valid range ending today or earlier."); return; }
    setError("");
    const timer = setTimeout(() => onSelect({ preset: "custom", from, to }), 300);
    return () => clearTimeout(timer);
  }, [from, to, dirty, view, period.today, onSelect]);

  function prepareOpen() {
    if (open) return;
    let active = period;
    try { active = resolveReportPeriod(Object.fromEntries(new URLSearchParams(getQuery()))); } catch { /* Use the displayed safe period for an invalid URL. */ }
    setYear(active.year); setMonth(active.month); setError("");
    setView(active.week ? "week" : active.preset === "month" || active.preset === "this-month" ? "month" : "day");
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const height = Math.min(440, window.innerHeight - 32);
    const width = Math.min(480, window.innerWidth - 32);
    setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)), top: rect.bottom + 8 + height <= window.innerHeight - 16 ? rect.bottom + 8 : Math.max(16, rect.top - height - 8) });
  }
  function choose(patch: Record<string, string>) {
    setDirty(false); setError("");
    if (onSelect(patch)) { popup.current?.hidePopover(); trigger.current?.focus(); }
  }
  function changeView(next: View) { setView(next); setDirty(false); setError(""); }

  return <div className="report-date-field report-field">
    <span>Date range</span>
    <button ref={trigger} type="button" className="date-picker-trigger" aria-label={`Date range: ${selectionTitle(period)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} onClick={prepareOpen}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/></svg>
      <span>{selectionTitle(period)}</span><span className="date-picker-chevron" aria-hidden="true">⌄</span>
    </button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-label="Choose reporting dates" className="date-picker-popover" style={position} onToggle={event => setOpen(event.currentTarget.matches(":popover-open"))}>
      <nav className="date-picker-shortcuts" aria-label="Date choices">
        <div className="date-picker-shortcut-list">{shortcuts.map(([key, label]) => <button key={key} type="button" aria-pressed={period.preset === key} onClick={() => choose({ preset: key })}>{label}</button>)}</div>
        <div className="date-picker-views">{views.map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => changeView(key)}>{label}<span aria-hidden="true">›</span></button>)}</div>
      </nav>
      <div className="date-picker-calendar">
        <div className="date-picker-panel-heading"><strong>{views.find(([key]) => key === view)?.[1]}</strong><button type="button" className="date-picker-close" aria-label="Close date picker" onClick={() => { popup.current?.hidePopover(); trigger.current?.focus(); }}>×</button></div>
        {view !== "year" && view !== "custom" && <div className="date-picker-year">
          <button type="button" aria-label="Previous year" disabled={year === 2000} onClick={() => setYear(value => value - 1)}>‹</button>
          <select aria-label="Reporting year" value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(value => <option key={value}>{value}</option>)}</select>
          <button type="button" aria-label="Next year" disabled={year === currentYear} onClick={() => setYear(value => value + 1)}>›</button>
        </div>}
        {(view === "day" || view === "week") && <select className="date-picker-month" aria-label="Reporting month" value={month} onChange={event => setMonth(Number(event.target.value))}>{months.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select>}
        {view === "day" && <div className="date-picker-days" role="group" aria-label={`${months[month - 1]} ${year}`}>
          {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map(day => <span key={day} className="date-picker-weekday">{day}</span>)}
          {Array.from({ length: offset }, (_, index) => <span key={`blank-${index}`} aria-hidden="true"/>)}
          {Array.from({ length: lastDay }, (_, index) => index + 1).map(day => { const date = dateKey(year, month, day); return <button type="button" key={day} aria-label={date} disabled={date > period.today} aria-pressed={date >= period.from && date <= period.to} onClick={() => choose({ preset: "custom", from: date, to: date })}>{day}</button>; })}
        </div>}
        {view === "week" && <div className="date-picker-weeks">
          <button type="button" className="date-picker-relative" onClick={() => choose({ preset: "this-week" })}>This week</button>
          {[1, 2, 3, 4].map(week => <button type="button" key={week} disabled={dateKey(year, month, (week - 1) * 7 + 1) > period.today} aria-pressed={period.week === week && period.year === year && period.month === month} onClick={() => choose({ preset: "month-week", year: String(year), month: String(month), week: String(week) })}><strong>Week {week}</strong><span>{(week - 1) * 7 + 1}–{week === 4 ? lastDay : week * 7} {months[month - 1].slice(0, 3)}</span></button>)}
        </div>}
        {view === "month" && <>
          <button type="button" className="date-picker-relative" onClick={() => choose({ preset: "this-month" })}>This month</button>
          <div className="date-picker-months" role="group" aria-label={`Months in ${year}`}>{months.map((name, index) => <button type="button" key={name} aria-label={`${name} ${year}`} disabled={dateKey(year, index + 1, 1) > period.today} aria-pressed={period.preset === "month" && period.year === year && period.month === index + 1} onClick={() => choose({ preset: "month", year: String(year), month: String(index + 1) })}>{name.slice(0, 3)}</button>)}</div>
        </>}
        {view === "year" && <div className="date-picker-years" role="group" aria-label="Reporting years">{years.map(value => <button key={value} type="button" onClick={() => choose({ preset: "custom", from: `${value}-01-01`, to: value === currentYear ? period.today : `${value}-12-31` })}>{value}</button>)}</div>}
        {view === "custom" && <div className="date-picker-custom">
          <p>Choose dates. Valid changes update the report automatically.</p>
          <label className="report-field">From<input aria-label="From date" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} type="date" min="2000-01-01" max={period.today} value={from} onChange={event => { setFrom(event.target.value); setDirty(true); }}/></label>
          <label className="report-field">To<input aria-label="To date" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} type="date" min="2000-01-01" max={period.today} value={to} onChange={event => { setTo(event.target.value); setDirty(true); }}/></label>
          {error && <p id={`${id}-error`} className="report-error" role="alert">{error}</p>}
        </div>}
        <p className="date-picker-timezone">All dates in Jakarta · WIB</p>
      </div>
    </div>
  </div>;
}
