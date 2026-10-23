import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { loginMissing, isDemo } from "@/server/env";

export const dynamic = "force-dynamic";
export default function Setup() {
  const missing = loginMissing();
  return <div className="auth-page"><div className="auth-theme"><ThemeSwitcher/></div><div className="auth-panel"><Link href="/" className="brand">datoko<span className="brand-period">.</span></Link><h1>Setup</h1><p>Sign-in needs to be configured before you can connect a shop.</p>{missing.length ? <ul className="setup-list">{missing.map(key => <li key={key}>{key}</li>)}</ul> : <p>Login configuration is present.</p>}<Link className="button" href={isDemo() ? "/overview" : "/login"}>{isDemo() ? "Explore demo workspace" : "Continue to sign-in"}</Link><small>No credentials are shown or accepted on this public setup page.</small></div></div>;
}
