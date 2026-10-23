import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return <AuthShell title="Page not found" description="This page or record is unavailable. Check the link or return to Overview."><Button asChild className="w-full"><Link href="/overview">Back to overview</Link></Button></AuthShell>;
}
