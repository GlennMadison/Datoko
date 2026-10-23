"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
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
  const [open, setOpen] = useState(false);
  const period = new URLSearchParams();
  for (const key of REPORT_KEYS) if (search.getAll(key).length === 1) period.set(key, search.get(key)!);
  const current = links.find(([href]) => pathname.startsWith(href))?.[1] ?? "Navigation";
  return <div className="navigation-container" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.currentTarget.querySelector<HTMLButtonElement>(".mobile-menu")?.focus(); } }}>
    <button type="button" className="mobile-menu" aria-expanded={open} aria-controls="main-navigation" onClick={() => setOpen(value => !value)}><span>{current}</span><span>{open ? "Close" : "Menu"} <span aria-hidden="true">{open ? "−" : "+"}</span></span></button>
    <nav id="main-navigation" className={`navigation ${open ? "navigation-open" : ""}`} aria-label="Main navigation">{links.map(([href, label, icon], index) => <div key={href}>{index === 5 && <p className="nav-section">Settings</p>}<Link className={`nav-link ${pathname.startsWith(href) ? "active" : ""}`} onClick={() => setOpen(false)} href={`${href}${index < 5 && period.size ? `?${period}` : ""}`} aria-current={pathname.startsWith(href) ? "page" : undefined}><Icon name={icon}/><span>{label}</span></Link></div>)}</nav>
  </div>;
}
