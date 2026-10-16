import { AppError } from "./errors.ts";

const SCALE = 10_000n;

export function amountUnits(value: string | number): bigint {
  const text = String(value);
  const match = /^(-?)(\d{1,16})(?:\.(\d{1,4}))?$/.exec(text);
  if (!match) throw new AppError("INVALID_MONEY");
  const unsigned = BigInt(match[2]) * SCALE + BigInt((match[3] ?? "").padEnd(4, "0"));
  return match[1] ? -unsigned : unsigned;
}

export function amountString(units: bigint): string {
  const sign = units < 0n ? "-" : "";
  const absolute = units < 0n ? -units : units;
  return `${sign}${absolute / SCALE}.${String(absolute % SCALE).padStart(4, "0")}`;
}

export type FinancialAmounts = { sales: string; refunds: string; fees: string };

export function financialDeltas(before: FinancialAmounts | null, after: FinancialAmounts): { component: string; amount: string }[] {
  const entries: { component: string; amount: string }[] = [];
  for (const component of ["sales", "refunds", "fees"] as const) {
    const current = amountUnits(after[component]);
    if (current < 0n) throw new AppError("INVALID_FINANCIAL_SNAPSHOT");
    const difference = current - amountUnits(before?.[component] ?? "0");
    const signed = component === "sales" ? difference : -difference;
    if (signed !== 0n) entries.push({ component, amount: amountString(signed) });
  }
  return entries;
}
