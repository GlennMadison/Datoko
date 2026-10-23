"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type ReactNode } from "react";
import { ArrowUpRight, ChartNoAxesCombined, ChevronsUpDown, LayoutDashboard, Megaphone, Package, Plug, RefreshCw, RotateCcw, ShoppingBag, Store } from "lucide-react";
import { Brand } from "./brand";
import { SignOut } from "./auth-actions";
import { ThemeSwitcher } from "./theme-switcher";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";
import { REPORT_KEYS } from "@/core/reporting-period";

const reportLinks = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/products", label: "Products & costs", icon: Package },
  { href: "/returns", label: "Returns", icon: RotateCcw },
  { href: "/advertisement", label: "Advertisement", icon: Megaphone },
];
const settingsLinks = [
  { href: "/settings/integrations", label: "Connections", icon: Plug },
  { href: "/settings/sync", label: "Sync history", icon: RefreshCw },
];

function WorkspaceNavigation() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { setOpenMobile } = useSidebar();
  const period = new URLSearchParams();
  for (const key of REPORT_KEYS) if (search.getAll(key).length === 1) period.set(key, search.get(key)!);
  return <nav aria-label="Main navigation">
    {[{ label: "Workspace", links: reportLinks, report: true }, { label: "Settings", links: settingsLinks, report: false }].map(group =>
      <SidebarGroup key={group.label}>
        <SidebarGroupLabel className="px-3 text-[11px] font-medium text-muted-foreground">{group.label}</SidebarGroupLabel>
        <SidebarGroupContent><SidebarMenu className="gap-1">{group.links.map(item =>
          <SidebarMenuItem key={item.href}>
            <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)} tooltip={item.label} className="h-10 rounded-lg px-3 text-[13px] font-medium data-[active=true]:bg-primary/10 data-[active=true]:text-primary">
              <Link href={item.href + (group.report && period.size ? "?" + period : "")} onClick={() => setOpenMobile(false)} aria-current={pathname.startsWith(item.href) ? "page" : undefined}>
                <item.icon className="size-[18px]" aria-hidden="true"/><span>{item.label}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}</SidebarMenu></SidebarGroupContent>
      </SidebarGroup>
    )}
  </nav>;
}

function ShellContents({ children, demo, name }: { children: ReactNode; demo: boolean; name: string }) {
  const pathname = usePathname();
  const { state, isMobile, openMobile, open } = useSidebar();
  const current = [...reportLinks, ...settingsLinks].find(item => pathname.startsWith(item.href))?.label ?? "Workspace";
  return <>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="gap-6 px-4 pt-6 pb-4 group-data-[collapsible=icon]:px-2">
        <Brand compact={state === "collapsed" && !isMobile}/>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild size="lg" tooltip="Connection settings" className="h-auto rounded-xl border bg-background/60 p-2.5 hover:bg-background group-data-[collapsible=icon]:border-transparent">
          <Link href="/settings/integrations"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card"><Store className="size-4 text-primary" aria-hidden="true"/></span><span className="grid flex-1 gap-0.5 leading-tight"><span className="text-xs font-semibold">Shopee Indonesia</span><span className="text-[11px] text-muted-foreground">{demo ? "Demo workspace" : "Your workspace"}</span></span><ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true"/></Link>
        </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-3 px-2 group-data-[collapsible=icon]:px-0"><WorkspaceNavigation/></SidebarContent>
      <SidebarFooter className="gap-4 p-4 group-data-[collapsible=icon]:px-2">
        <Link href="/settings/sync" className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-background/50 px-3 py-2.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden"><span className="size-1.5 rounded-full bg-primary" aria-hidden="true"/>{demo ? "Read-only demo" : "View sync activity"}<ArrowUpRight className="ml-auto size-3.5" aria-hidden="true"/></Link>
        <div className="flex items-center gap-2.5 border-t pt-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border bg-card text-xs font-semibold text-primary" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || "D"}</span>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden"><p className="truncate text-xs font-semibold">{name}</p>{demo ? <p className="mt-0.5 text-[11px] text-muted-foreground">Sample data</p> : <SignOut/>}</div>
        </div>
      </SidebarFooter>
      <SidebarRail/>
    </Sidebar>
    <SidebarInset className="min-w-0 bg-background">
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur-sm sm:px-7">
        <div className="flex min-w-0 items-center gap-3"><SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" aria-expanded={isMobile ? openMobile : open}/><Separator orientation="vertical" className="!h-4"/><span className="truncate text-[13px] font-medium">{current}</span></div>
        <div className="flex shrink-0 items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:inline">Jakarta · WIB</span><ThemeSwitcher/><Badge variant="outline" className="hidden gap-1.5 bg-card text-[11px] font-normal sm:flex"><Store className="size-3" aria-hidden="true"/>Shopee</Badge></div>
      </header>
      {demo && <div className="demo-banner"><span><strong>Demo workspace</strong><span className="hidden sm:inline"> · </span><span>Sample data. No Shopee shop is connected.</span></span><Link href="/settings/integrations">Connection settings <ArrowUpRight className="size-3.5" aria-hidden="true"/></Link></div>}
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="footer"><span className="flex items-center gap-1.5"><ChartNoAxesCombined className="size-3.5" aria-hidden="true"/>Datoko</span><span>IDR · Asia/Jakarta (WIB)</span></footer>
    </SidebarInset>
  </>;
}

export function DashboardShell({ defaultOpen = true, ...props }: { children: ReactNode; demo: boolean; name: string; defaultOpen?: boolean }) {
  return <SidebarProvider defaultOpen={defaultOpen}><ShellContents {...props}/></SidebarProvider>;
}
