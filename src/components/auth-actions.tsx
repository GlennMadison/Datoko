"use client";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createAuthClient } from "better-auth/react";
import { Button } from "./ui";

const authClient = createAuthClient();

function passwordError(code: string | undefined, signUp: boolean) {
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "The email or password is incorrect.";
  if (code === "AUTH_METHOD_REQUIRED") return "Use the configured sign-in method for this account.";
  if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return "An account already exists for this email. Sign in instead.";
  if (code === "PASSWORD_TOO_SHORT") return "Use at least 12 characters for your password.";
  if (code === "PASSWORD_TOO_LONG") return "Use no more than 128 characters for your password.";
  if (code === "EMAIL_PASSWORD_SIGN_UP_DISABLED") return "Signup is closed. Sign in with your existing account.";
  return signUp ? "Your account could not be created. Please try again." : "Sign-in failed. Check your details and try again.";
}

export function PasswordForm({ disabled, signUp = false }: { disabled: boolean; signUp?: boolean }) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setReady(true); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || busy) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    setError("");
    if (signUp && password !== form.get("confirmPassword")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = signUp
        ? await authClient.signUp.email({ name: String(form.get("name") ?? "").trim(), email, password, callbackURL: "/overview" })
        : await authClient.signIn.email({ email, password, callbackURL: "/overview" });
      if (result.error) {
        setError(result.error.status === 429 ? "Too many attempts. Wait a minute and try again." : passwordError(result.error.code, signUp));
        setBusy(false);
        return;
      }
      window.location.assign("/overview");
    } catch {
      setError("Could not reach the server. Please try again.");
      setBusy(false);
    }
  }
  return <form className="auth-form" method="post" onSubmit={submit} aria-label={signUp ? "Create account" : "Sign in"} aria-busy={busy} aria-describedby={error ? "auth-error" : undefined}>
    <fieldset disabled={!ready || disabled || busy}>
      {signUp && <label htmlFor="auth-name">Name<input id="auth-name" name="name" autoComplete="name" required maxLength={100}/></label>}
      <label htmlFor="auth-email">Email<input id="auth-email" name="email" type="email" autoComplete="email" required maxLength={254}/></label>
      <label htmlFor="auth-password">Password<input id="auth-password" name="password" type="password" autoComplete={signUp ? "new-password" : "current-password"} required minLength={signUp ? 12 : 1} maxLength={128} aria-describedby={signUp ? "password-help" : undefined}/></label>
      {signUp && <><p id="password-help" className="auth-hint">Use 12–128 characters.</p><label htmlFor="auth-confirm">Confirm password<input id="auth-confirm" aria-invalid={error === "The passwords do not match."} name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128}/></label></>}
      <Button type="submit">{busy ? (signUp ? "Creating account…" : "Signing in…") : (signUp ? "Create account" : "Sign in")}</Button>
    </fieldset>
    {error && <p id="auth-error" className="auth-error" role="alert">{error}</p>}
  </form>;
}

export function GoogleSignIn({ disabled }: { disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <><Button disabled={disabled || busy} onClick={async () => {
    setBusy(true); setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL: "/overview", errorCallbackURL: "/login?error=sign_in_failed" });
      if (result.error) throw new Error();
    } catch { setError("Sign-in could not be started. Check the server configuration."); setBusy(false); }
  }}>{busy ? "Opening Google…" : "Continue with Google"}</Button>{error && <p className="page-note" role="alert">{error}</p>}</>;
}
export function SignOut() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setReady(true); }, []);
  return <><button type="button" className="sign-out" disabled={!ready || busy} onClick={async () => {
    setBusy(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.assign("/login");
    } catch { setError("Sign-out failed. Please try again."); setBusy(false); }
  }}>{busy ? "Signing out…" : "Sign out"}</button>{error && <span role="alert">{error}</span>}</>;
}
