"use client";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <AuthShell title="Could not load this page" description="Try again in a moment. Your saved records are unchanged."><Button onClick={reset} className="w-full">Try again</Button><Link href="/setup" className="auth-secondary">View setup requirements</Link></AuthShell>;
}
