import type { ReportQuery } from "./reporting-period.ts";
export type OrderSort = "name" | "createdAt" | "total" | "profit";
export type OrderPage = { page: number; pageSize: number; sort: OrderSort; direction: "asc" | "desc" };
export function orderPage(query: ReportQuery): OrderPage & { search: string; status: string } {
  const size = Number(query.size);
  const page = typeof query.page === "string" && /^\d{1,6}$/.test(query.page) ? Number(query.page) : 1;
  return { page: Math.max(1, Math.min(page, 50_000)), pageSize: [10, 25, 50].includes(size) ? size : 25,
    sort: typeof query.sort === "string" && ["name", "createdAt", "total", "profit"].includes(query.sort) ? query.sort as OrderSort : "createdAt",
    direction: query.dir === "asc" ? "asc" : "desc", search: typeof query.q === "string" ? query.q.slice(0, 200) : "",
    status: typeof query.status === "string" && ["COMPLETED", "CANCELLED", "READY_TO_SHIP", "SHIPPED"].includes(query.status) ? query.status : "" };
}
