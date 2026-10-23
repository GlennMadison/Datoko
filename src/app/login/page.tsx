import Link from "next/link";
import { getConfig, isDemo, loginMissing } from "@/server/env";
import { GoogleSignIn, PasswordForm } from "@/components/auth-actions";

export const dynamic = "force-dynamic";
export default function Login() {
  const configured = loginMissing().length === 0 && !isDemo();
  const config = getConfig();
  const passwordLogin = config.AUTH_METHOD === "email-password";
  return <div className="auth-page"><div className="auth-panel"><Link href="/" className="brand"><span className="brand-mark"><i/><i/><i/></span>datoko<span className="brand-period">.</span></Link><h1>Sign in</h1><p>Use your account to access your shops.</p>{passwordLogin ? <PasswordForm disabled={!configured}/> : <GoogleSignIn disabled={!configured}/>}{passwordLogin && config.EMAIL_SIGNUP_ENABLED === "true" && <Link className="auth-secondary" href="/signup">Create your account</Link>}{!configured && <><small>{isDemo() ? "Account access is disabled in this read-only demo." : "Account access is unavailable until setup is complete."}</small><Link className="auth-secondary" href="/setup">View setup requirements</Link></>}<Link className="auth-secondary" href={isDemo() ? "/overview" : "/"}>{isDemo() ? "Explore the read-only demo" : "Back to Datoko"}</Link></div></div>;
}
