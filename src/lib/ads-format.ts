export function adsMoney(value: string | null): string {
  if (value === null) return "Unavailable";
  const [whole, fraction = ""] = value.split(".");
  const rounded = BigInt(whole) + (Number(fraction[0] ?? "0") >= 5 ? 1n : 0n);
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(rounded);
}
export const adsRatio = (value: string | null) => value === null ? "Unavailable" : `${value}x`;
