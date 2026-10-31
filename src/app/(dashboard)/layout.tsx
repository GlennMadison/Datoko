import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo, loginMissing } from "@/server/env";
import { requireDashboardUser } from "@/server/dashboard";
import { workspaceStatus } from "@/server/workspace-status";
import { WorkspaceRefresh } from "@/components/workspace-refresh";
import { DashboardShell } from "@/components/dashboard-shell";
import { ReportNavigationProvider } from "@/components/report-navigation";

// headers/cookies keep HTML private and dynamic while explicit data caches can be reused.

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  let actor: Awaited<ReturnType<typeof requireDashboardUser>> | null = null;
  if (!demo) {
    if (loginMissing().length) redirect("/setup");
    try { actor = await requireDashboardUser(); } catch { redirect("/login"); }
  }
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return <DashboardShell defaultOpen={defaultOpen} demo={demo} name={demo ? "Demo workspace" : actor?.name || "Your account"}>
    <ReportNavigationProvider demo={demo}>{actor && <WorkspaceRefresh initial={await workspaceStatus(actor.ownerId)}/>} {children}</ReportNavigationProvider>
  </DashboardShell>;
}
