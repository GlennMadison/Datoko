"use client";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="auth-page"><div className="auth-panel"><h1>We couldn&apos;t load this view.</h1><p>Your saved records are retained. Check the database connection and server configuration, then try again.</p><button className="button" onClick={reset}>Try again</button><Link href="/setup" className="auth-secondary">View setup requirements</Link></div></div>; }
