"use client";

// The public list: identical plain-text output to the admin screen, same
// copy button, nothing editable.

import { useMemo } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { buildListExport } from "@/lib/pool";
import { Button } from "@/components/ui/button";

export function PublicList({
  entries,
}: {
  entries: { name: string; blockNumber: number }[];
}) {
  const text = useMemo(() => buildListExport(2026, entries), [entries]);
  const lineCount = text.split("\n").length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied");
    } catch {
      toast.error("Copy failed — long-press the text and copy manually.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl">List</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Plain text. Pastes clean into the group chat.
          </p>
        </div>
        <Button className="shrink-0" onClick={copy}>
          <Copy data-icon="inline-start" />
          Copy
        </Button>
      </div>

      <div className="space-y-1.5">
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 font-mono text-sm">
          {text}
        </pre>
        <p className="text-2xs text-muted-foreground" data-numeric>
          {lineCount} lines
        </p>
      </div>
    </div>
  );
}
