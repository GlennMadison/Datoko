import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
import { loginMissing, isDemo } from "@/server/env";

export const dynamic = "force-dynamic";
export default function Setup() {
  const missing = loginMissing();
  return <AuthShell title="Setup" description="Configure sign-in before connecting a shop.">
    {missing.length ? <ul className="setup-list">{missing.map(key => <li key={key}>{key}</li>)}</ul> : <p className="mb-6 text-sm text-muted-foreground">Login configuration is present.</p>}
    <Button asChild className="w-full"><Link href={isDemo() ? "/overview" : "/login"}>{isDemo() ? "Explore demo workspace" : "Continue to sign-in"}</Link></Button>
    <small>No credentials are shown or accepted on this public setup page.</small>
  </AuthShell>;
}
