import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Datoko", template: "%s | Datoko" }, description: "Track Shopee orders, product costs, returns, and advertising performance." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<SpeedInsights/></body></html>; }
