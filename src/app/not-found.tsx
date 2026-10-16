import Link from "next/link";
export default function NotFound() { return <div className="auth-page"><div className="auth-panel"><p className="eyebrow">NOT FOUND</p><h1>That record isn&apos;t here.</h1><p>Check the link or return to your workspace.</p><Link className="button" href="/overview">Back to overview</Link></div></div>; }
