"use client";

// Participants with no email and no phone, grouped by the owner who relays
// for them. If one of these blocks hits, there is no way to tell the winner.
// Each group copies as a plain-text ask to hand that owner directly.

import { useState } from "react";
import { toast } from "sonner";
import { PhoneOff, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { contactGapMessage, type ContactGapGroup } from "@/lib/contact-gaps";

export function ContactGaps({ groups }: { groups: ContactGapGroup[] }) {
  const [copied, setCopied] = useState<string | null>(null);

  if (groups.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <Header count={0} blocks={0} />
        <p className="text-sm text-muted-foreground">
          Everyone has an email or a phone. Every winner can be reached.
        </p>
      </section>
    );
  }

  const people = groups.reduce((n, g) => n + g.people.length, 0);
  const blocks = groups.reduce((n, g) => n + g.blockCount, 0);

  const copy = async (g: ContactGapGroup) => {
    try {
      await navigator.clipboard.writeText(contactGapMessage(g));
      setCopied(g.group);
      setTimeout(() => setCopied(null), 2000);
      toast.success(`Copied the ${g.group} ask — send it to them directly.`);
    } catch {
      toast.error("Could not copy. Select the list and copy it by hand.");
    }
  };

  return (
    <section className="rounded-lg border border-halftime/50 bg-surface p-4">
      <Header count={people} blocks={blocks} />
      <p className="mb-3 text-sm text-muted-foreground">
        No email and no phone. If one of these blocks hits, there is no way to
        tell them they won — get contact details before kickoff.
      </p>

      <div className="space-y-3">
        {groups.map((g) => (
          <div
            key={g.group}
            className="rounded-md border border-border bg-surface-2 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{g.group}</span>
                <span className="text-2xs text-muted-foreground" data-numeric>
                  {g.people.length}{" "}
                  {g.people.length === 1 ? "person" : "people"} ·{" "}
                  {g.blockCount} block{g.blockCount === 1 ? "" : "s"}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-9 shrink-0 sm:h-7"
                onClick={() => copy(g)}
              >
                {copied === g.group ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <Copy className="size-3.5" aria-hidden />
                )}
                <span className="ml-1.5">Copy ask</span>
              </Button>
            </div>
            <ul className="space-y-1">
              {g.people.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-2xs text-muted-foreground" data-numeric>
                    {p.blocks.length
                      ? p.blocks.map((b) => `#${b}`).join(" · ")
                      : "no block yet"}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Header({ count, blocks }: { count: number; blocks: number }) {
  return (
    <h2
      className={cn(
        "mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-semibold tracking-widest uppercase",
        count > 0 ? "text-halftime" : "text-muted-foreground",
      )}
    >
      <PhoneOff className="size-3.5 shrink-0" aria-hidden />
      No contact on file
      {count > 0 ? (
        <span className="tracking-normal normal-case" data-numeric>
          {count} {count === 1 ? "person" : "people"} · {blocks} block
          {blocks === 1 ? "" : "s"}
        </span>
      ) : null}
      <span className="rounded border border-border px-1 py-px text-[9px] tracking-normal normal-case text-muted-foreground">
        admin only
      </span>
    </h2>
  );
}
