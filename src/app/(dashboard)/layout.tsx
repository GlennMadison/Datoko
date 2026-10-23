import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo, loginMissing } from "@/server/env";
import { requireUser } from "@/server/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { ReportNavigationProvider } from "@/components/report-navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const demo = isDemo();
  let actor: Awaited<ReturnType<typeof requireUser>> | null = null;
  if (!demo) {
    if (loginMissing().length) redirect("/setup");
    try { actor = await requireUser(await headers()); } catch { redirect("/login"); }
  }
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return <DashboardShell defaultOpen={defaultOpen} demo={demo} name={demo ? "Demo workspace" : actor?.name || "Your account"}>
    <ReportNavigationProvider>{children}</ReportNavigationProvider>
  </DashboardShell>;
}
