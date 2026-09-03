"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// The plain-text list is admin-only — it is a chase tool, not a viewer
// surface. /admin/list already carries it (and more).
const NAV = [
  { href: "/", label: "Home" },
  { href: "/grid", label: "Grid" },
  { href: "/blocks", label: "Board" },
  { href: "/players", label: "Players" },
  { href: "/schedule", label: "Schedule" },
  { href: "/winners", label: "Winners" },
  { href: "/admin", label: "Admin" },
] as const;

// Admin renders on its own at the far right of the desktop bar, so the
// inline list is everything else. Derived, not sliced by index: an added or
// removed destination used to shift the cut and duplicate a link.
const VIEWER_NAV = NAV.filter((item) => item.href !== "/admin");

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-7xl items-center gap-1 px-4 sm:px-6">
        <Link
          href="/"
          className="mr-2 flex shrink-0 items-baseline gap-1.5 font-semibold tracking-tight"
        >
          <span className="text-pool-accent">1622</span>
          <span>TNF</span>
          <span className="hidden text-2xs font-normal text-muted-foreground lg:inline">
            Block Pool ’26
          </span>
        </Link>

        {/* Desktop: inline nav */}
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 sm:flex">
          {VIEWER_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm whitespace-nowrap transition-colors duration-150 lg:px-2.5",
                isActive(pathname, item.href)
                  ? "bg-surface-2 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
          <div className="flex-1" />
          <Link
            href="/admin"
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150",
              isActive(pathname, "/admin")
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Admin
          </Link>
        </nav>

        {/* Phone: hamburger menu — every destination reachable at any width */}
        <div className="flex flex-1 items-center justify-end sm:hidden">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="rounded-md p-2 text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetHeader>
                <SheetTitle>
                  <span className="text-pool-accent">1622</span> TNF
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-2" aria-label="Site">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "rounded-md px-3 py-2.5 text-base transition-colors duration-150",
                      isActive(pathname, item.href)
                        ? "bg-surface-2 font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
