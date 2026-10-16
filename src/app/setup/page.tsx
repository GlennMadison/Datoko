import Link from "next/link";
import { loginMissing, isDemo } from "@/server/env";

export const dynamic = "force-dynamic";
export default function Setup() {
  const missing = loginMissing();
  return <div className="auth-page"><div className="auth-panel"><Link href="/" className="brand">datoko<span className="brand-period">.</span></Link><p className="eyebrow">WORKSPACE SETUP</p><h1>Make room for your shop.</h1><p>Configure the database and owner sign-in in your private environment file. The README contains the setup and redirect instructions.</p>{missing.length ? <ul className="setup-list">{missing.map(key => <li key={key}>{key}</li>)}</ul> : <p>Owner login configuration is present.</p>}<Link className="button" href={isDemo() ? "/overview" : "/login"}>{isDemo() ? "Explore demo workspace" : "Continue to sign-in"}</Link><small>No credentials are shown or accepted on this public setup page.</small></div></div>;
}
