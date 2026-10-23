import { ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, ChartNoAxesCombined, Check, Clock3, LayoutDashboard, Megaphone, Package, Plug, RefreshCw, RotateCcw, ShoppingBag } from "lucide-react";
const icons = { overview: LayoutDashboard, orders: ShoppingBag, products: Package, returns: RotateCcw, advertisement: Megaphone, connection: Plug, sync: RefreshCw, money: Banknote, arrow: ArrowRight, clock: Clock3, check: Check, up: ArrowUpRight, down: ArrowDownLeft, chart: ChartNoAxesCombined };
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Component = icons[name as keyof typeof icons] ?? Package;
  return <Component width={size} height={size} strokeWidth={1.7} aria-hidden="true" className="shrink-0"/>;
}
