import { Skeleton } from "@/components/ui/skeleton";
export default function DashboardLoading() {
  return <div role="status" aria-label="Loading dashboard" className="space-y-6">
    <Skeleton className="h-8 w-40"/><div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[1, 2, 3, 4].map(value => <Skeleton key={value} className="h-32 rounded-xl"/>)}</div>
    <Skeleton className="h-10 w-60"/><Skeleton className="h-80 w-full rounded-xl"/><span className="sr-only">Loading dashboard…</span>
  </div>;
}
