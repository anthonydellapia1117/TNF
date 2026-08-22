"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// "Home" hides on phones — the wordmark already goes home, and the four
// real destinations must fit a 380px viewport without truncating.
const NAV = [
  { href: "/", label: "Home", desktopOnly: true },
  { href: "/grid", label: "Grid" },
  { href: "/blocks", label: "Board" },
  { href: "/schedule", label: "Schedule" },
  { href: "/winners", label: "Winners" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
        <Link
          href="/"
          className="mr-2 flex shrink-0 items-baseline gap-1.5 font-semibold tracking-tight"
        >
          <span className="text-pool-accent">1622</span>
          <span>TNF</span>
          <span className="hidden text-2xs font-normal text-muted-foreground sm:inline">
            Block Pool ’26
          </span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 sm:px-2.5",
                  "desktopOnly" in item && item.desktopOnly && "hidden sm:block",
                  active
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/admin"
          className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          Admin
        </Link>
      </div>
    </header>
  );
}
