import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { getConfig, isDemo, loginMissing } from "@/server/env";
import { GoogleSignIn, PasswordForm } from "@/components/auth-actions";

export const dynamic = "force-dynamic";
export default function Login() {
  const configured = loginMissing().length === 0 && !isDemo();
  const config = getConfig();
  const passwordLogin = config.AUTH_METHOD === "email-password";
  return <AuthShell title="Sign in" description="Use your account to access your shops.">
    {passwordLogin ? <PasswordForm disabled={!configured}/> : <GoogleSignIn disabled={!configured}/>}
    {passwordLogin && config.EMAIL_SIGNUP_ENABLED === "true" && <Link className="auth-secondary" href="/signup">Create your account</Link>}
    {!configured && <><small>{isDemo() ? "Account access is disabled in this read-only demo." : "Account access is unavailable until setup is complete."}</small><Link className="auth-secondary" href="/setup">View setup requirements</Link></>}
    <Link className="auth-secondary" href={isDemo() ? "/overview" : "/"}>{isDemo() ? "Explore the read-only demo" : "Back to Datoko"}</Link>
  </AuthShell>;
}
