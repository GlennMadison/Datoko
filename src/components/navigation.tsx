"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "./icons";
import { REPORT_KEYS } from "@/core/reporting-period";

const links = [
  ["/overview", "Overview", "overview"], ["/orders", "Orders", "orders"], ["/products", "Products & costs", "products"], ["/returns", "Returns", "returns"],
  ["/advertisement", "Advertisement", "advertisement"],
  ["/settings/integrations", "Connections", "connection"], ["/settings/sync", "Sync history", "sync"],
];
export function Navigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const period = new URLSearchParams();
  for (const key of REPORT_KEYS) if (search.getAll(key).length === 1) period.set(key, search.get(key)!);
  return <nav className="navigation" aria-label="Main navigation">{links.map(([href, label, icon], index) => <div key={href}>{index === 5 && <p className="nav-section">WORKSPACE</p>}<Link className={`nav-link ${pathname.startsWith(href) ? "active" : ""}`} href={`${href}${index < 5 && period.size ? `?${period}` : ""}`} aria-current={pathname.startsWith(href) ? "page" : undefined}><Icon name={icon}/><span>{label}</span>{pathname.startsWith(href) && <span className="active-dot"/>}</Link></div>)}</nav>;
}
