import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  // Never let a late font swap re-trigger LCP: if the font misses first
  // paint, the metric-matched fallback stays.
  display: "optional",
  preload: true,
});

export const metadata: Metadata = {
  title: {
    default: "1622 TNF Block Pool",
    template: "%s · 1622 TNF Block Pool",
  },
  description:
    "1622 TNF Block Pool, 2026 season — live grid, winners, and payouts. 100 blocks, 23 games, $44,250 in payouts.",
};

export const viewport: Viewport = {
  themeColor: "#0B0D0F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${geistSans.variable}`}>
      <body className="antialiased min-h-dvh">
        <SiteHeader />
        <main className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">
          {children}
        </main>
        <Toaster />
      </body>
    </html>
  );
}
