import Link from "next/link";
import { ThemeSwitcher } from "@/components/theme-switcher";
export default function NotFound() { return <div className="auth-page"><div className="auth-theme"><ThemeSwitcher/></div><div className="auth-panel"><h1>Page not found</h1><p>This page or record is unavailable. Check the link or return to Overview.</p><Link className="button" href="/overview">Back to overview</Link></div></div>; }
