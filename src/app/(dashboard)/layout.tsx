import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo, loginMissing } from "@/server/env";
import { requireOwner } from "@/server/auth";
import { Navigation } from "@/components/navigation";
import { Icon } from "@/components/icons";
import { SignOut } from "@/components/auth-actions";
import { ReportNavigationProvider } from "@/components/report-navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  if (!demo) {
    if (loginMissing().length) redirect("/setup");
    try { await requireOwner(await headers()); } catch { redirect("/login"); }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/overview" className="brand">
          <span className="brand-mark"><i/><i/><i/></span>
          datoko<span className="brand-period">.</span>
        </Link>
        <div className="workspace-switch">
          <span className="shop-avatar">D</span>
          <div><strong>Your workspace</strong><span>Shopee Indonesia</span></div>
          <span className="workspace-chevron">⌄</span>
        </div>
        <p className="nav-section">YOUR BUSINESS</p>
        <Navigation/>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="clock"/>
            <p>Your records stay.<br/><span>Your data stays up to date.</span></p>
          </div>
          <div className="owner">
            <span className="owner-avatar">{demo ? "D" : "G"}</span>
            <div>
              <strong>{demo ? "Demo workspace" : "Workspace owner"}</strong>
              {demo ? <span>Sample data</span> : <SignOut/>}
            </div>
            <span className="owner-status"/>
          </div>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span>/</span> Dashboard</span>
          <div className="topbar-right">
            {!demo && <span className="mobile-sign-out"><SignOut/></span>}
            <span className="platform-badge"><span/>Shopee</span>
            <span className="topbar-divider"/>
            <span className="timezone">Jakarta · WIB</span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span><strong>Demo workspace</strong> Explore sample data. No Shopee shop is connected.</span>
            <Link href="/settings/integrations">Set up connection <Icon name="arrow" size={14}/></Link>
          </div>
        )}
        <main className="main-content"><ReportNavigationProvider>{children}</ReportNavigationProvider></main>
        <footer className="footer">
          <span>datoko. <span className="muted-dot">·</span> A clearer view of your business</span>
          <span>All times in WIB</span>
        </footer>
      </div>
    </div>
  );
}
