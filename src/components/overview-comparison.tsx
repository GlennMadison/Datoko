import { percentChange } from "@/core/metric-comparison";

export function OverviewComparison({ current, previous, label, format, lowerIsBetter = false }: {
  current: number | null; previous: number | null; label: string; format: (value: number) => string; lowerIsBetter?: boolean;
}) {
  const change = percentChange(current, previous);
  const isNew = previous === 0 && current !== null && current !== 0;
  const direction = change === null ? 0 : Math.sign(change);
  const positive = (direction > 0) !== lowerIsBetter;
  const tone = direction === 0 ? "text-muted-foreground" : positive ? "text-primary" : "text-destructive";
  return <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-[11px] leading-relaxed" title={label}>
    <span className="text-muted-foreground">{label.split(" (")[0]}<span className="numeric ml-1.5 font-medium text-foreground">{previous === null ? "Unavailable" : format(previous)}</span></span>
    <span className={`numeric shrink-0 font-medium ${tone}`} title={isNew ? "The previous value was zero, so a percentage change cannot be calculated." : undefined}>{isNew ? "New" : change === null ? "-" : `${change > 0 ? "↑ +" : change < 0 ? "↓ " : ""}${change.toFixed(1)}%`}</span>
  </div>;
}
