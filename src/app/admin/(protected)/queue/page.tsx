import type { Metadata } from "next";
import { getPendingActions } from "@/lib/data/admin";
import { fmtDateTimeET } from "@/lib/format";
import { summarizePayload } from "@/lib/pending";
import { Badge } from "@/components/ui/badge";
import { QueueActions } from "@/components/admin/queue/queue-actions";

export const metadata: Metadata = { title: "Queue" };
export const dynamic = "force-dynamic";

// The NEEDS ANTHONY queue. Rows are what the sweep staged and did not
// decide. This is a server component: the list renders here under the admin
// session, and only the two buttons per row are client code.
export default async function QueuePage() {
  const { items, unavailable } = await getPendingActions();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Queue</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          What the sweep could not decide. Approve applies an item only
          through the same admin action you would press yourself; Dismiss
          closes it and changes nothing.
        </p>
      </div>

      {unavailable ? (
        <div className="rounded-lg border border-halftime/50 bg-halftime/10 px-4 py-6 text-sm">
          <p className="font-medium">The queue table is not in this database yet.</p>
          <p className="mt-1 text-muted-foreground">
            Apply migration 23 (pending_actions) after the local SQL suites
            pass. Until then nothing can be staged here.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing waiting on you.
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          {items.map((item) => (
            <div
              key={item.id}
              className="space-y-2 border-b border-border border-l-2 border-l-halftime px-3 py-3 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge variant="outline" className="font-mono">
                  {item.kind}
                </Badge>
                <span className="text-sm font-medium">
                  {summarizePayload(item.kind, item.payload)}
                </span>
              </div>
              <p className="text-2xs text-muted-foreground" data-numeric>
                staged {fmtDateTimeET(item.staged_at)}
                {item.source_message_id
                  ? ` · message ${item.source_message_id}`
                  : " · no source message"}
              </p>
              <details className="text-2xs text-muted-foreground">
                <summary className="cursor-pointer select-none">
                  payload
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 font-mono text-[11px] whitespace-pre-wrap">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              </details>
              <QueueActions id={item.id} kind={item.kind} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
