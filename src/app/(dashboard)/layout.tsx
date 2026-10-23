import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo, loginMissing } from "@/server/env";
import { requireUser } from "@/server/auth";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Navigation } from "@/components/navigation";
import { SignOut } from "@/components/auth-actions";
import { ReportNavigationProvider } from "@/components/report-navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  let actor: Awaited<ReturnType<typeof requireUser>> | null = null;
  if (!demo) {
    if (loginMissing().length) redirect("/setup");
    try { actor = await requireUser(await headers()); } catch { redirect("/login"); }
  }
  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <aside className="sidebar">
      <Link href="/overview" className="brand" aria-label="Datoko home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>datoko<span className="brand-period">.</span></Link>
      <p className="workspace-label">Shopee Indonesia</p>
      <Navigation/>
      <div className="sidebar-bottom"><div className="owner">
        <span className="owner-avatar" aria-hidden="true">{demo ? "D" : actor?.name.trim().charAt(0).toUpperCase() || "D"}</span>
        <div><strong>{demo ? "Demo workspace" : actor?.name || "Your account"}</strong>{demo ? <span>Sample data</span> : <SignOut/>}</div>
      </div></div>
    </aside>
    <div className="main-area">
      <header className="topbar"><span className="workspace-title">Workspace</span><div className="topbar-right"><span>Jakarta · WIB</span><ThemeSwitcher/>{!demo && <span className="mobile-sign-out"><SignOut/></span>}</div></header>
      {demo && <div className="demo-banner"><span><strong>Demo</strong> Sample data. No Shopee shop is connected.</span><Link href="/settings/integrations">Connection settings</Link></div>}
      <main id="main-content" className="main-content" tabIndex={-1}><ReportNavigationProvider>{children}</ReportNavigationProvider></main>
      <footer className="footer"><span>Datoko</span><span>IDR · Asia/Jakarta (WIB)</span></footer>
    </div>
  </div>;
}
