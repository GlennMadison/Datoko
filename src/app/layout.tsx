import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Datoko — Your shop, clearly", template: "%s | Datoko" }, description: "A private Shopee dashboard for orders, product costs, and reliable business history." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
