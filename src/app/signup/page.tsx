import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordForm } from "@/components/auth-actions";
import { getConfig, isDemo, loginMissing } from "@/server/env";

export const dynamic = "force-dynamic";
export default function Signup() {
  const config = getConfig();
  if (config.AUTH_METHOD !== "email-password" || config.EMAIL_SIGNUP_ENABLED !== "true") redirect("/login");
  const configured = loginMissing().length === 0 && !isDemo();
  return <div className="auth-page"><div className="auth-panel">
    <Link href="/" className="brand"><span className="brand-mark"><i/><i/><i/></span>datoko<span className="brand-period">.</span></Link>
    <p className="eyebrow">YOUR PRIVATE WORKSPACE</p><h1>Create your account.</h1>
    <p>Set up your email and password to keep your shop&apos;s records close.</p>
    <PasswordForm disabled={!configured} signUp/>
    <small>Signup is available to the workspace owner.</small>
    <Link className="auth-secondary" href="/login">Already have an account? Sign in</Link>
    {!configured && <Link className="auth-secondary" href="/setup">View setup requirements</Link>}
  </div></div>;
}
