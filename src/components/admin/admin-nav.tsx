"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/admin/actions";

const ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/participants", label: "Participants" },
  { href: "/admin/blocks", label: "Blocks" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/games", label: "Games" },
  { href: "/admin/digits", label: "Digits" },
  { href: "/admin/score", label: "Score" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/list", label: "List" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ITEMS.map((item) => {
        const active =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors duration-150",
              active
                ? "bg-surface-2 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <button
        onClick={() => void signOut()}
        className="shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
      >
        Sign out
      </button>
    </div>
  );
}
