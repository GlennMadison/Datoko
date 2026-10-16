"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const links = [
  ["/overview", "Overview", "overview"], ["/orders", "Orders", "orders"], ["/products", "Products & costs", "products"], ["/returns", "Returns", "returns"],
  ["/settings/integrations", "Connections", "connection"], ["/settings/sync", "Sync history", "sync"],
];
export function Navigation() {
  const pathname = usePathname();
  return <nav className="navigation" aria-label="Main navigation">{links.map(([href, label, icon], index) => <div key={href}>{index === 4 && <p className="nav-section">WORKSPACE</p>}<Link className={`nav-link ${pathname.startsWith(href) ? "active" : ""}`} href={href} aria-current={pathname.startsWith(href) ? "page" : undefined}><Icon name={icon}/><span>{label}</span>{pathname.startsWith(href) && <span className="active-dot"/>}</Link></div>)}</nav>;
}
