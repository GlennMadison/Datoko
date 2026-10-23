import type { ReactNode } from "react";
import { Brand } from "./brand";
import { ThemeSwitcher } from "./theme-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

export function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="auth-page">
    <div className="auth-theme"><ThemeSwitcher/></div>
    <div className="w-full max-w-[420px]"><Brand className="mb-8 justify-center"/>
      <Card className="auth-panel gap-5 py-7 shadow-sm"><CardHeader className="text-center"><CardTitle><h1>{title}</h1></CardTitle><CardDescription className="mt-2 text-[13px] leading-relaxed">{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card>
      <p className="mt-6 text-center text-[11px] text-muted-foreground">Datoko · Shopee Indonesia</p>
    </div>
  </div>;
}
