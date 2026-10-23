"use client";
import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="auth-page"><div className="auth-theme"><ThemeSwitcher/></div><div className="auth-panel"><h1>Could not load this page</h1><p>Try again in a moment. Your saved records are unchanged.</p><button className="button" onClick={reset}>Try again</button><Link href="/setup" className="auth-secondary">View setup requirements</Link></div></div>; }
