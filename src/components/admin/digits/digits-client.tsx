"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dice5, Eye, Lock, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtKickoffET } from "@/lib/format";
import { gameCode } from "@/lib/pool";
import { matchupLabel } from "@/lib/nfl";
import { assignDigits, publishDigits } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BlocksGrid } from "@/components/grid/blocks-grid";
import type { AdminGame, PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

/** An AdminGame reshaped so the real public grid can render it in preview. */
function asPublicGame(g: AdminGame): PublicGame {
  return { ...g, digits_assigned: g.digits_assigned_at !== null };
}

export function DigitsClient({
  games,
  blocks,
  config,
}: {
  games: AdminGame[];
  blocks: PublicBlock[];
  config: PoolConfig;
}) {
  const [previewNo, setPreviewNo] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "assign" | "publish"; game: AdminGame } | null
  >(null);
  const [pending, startTransition] = useTransition();

  const preview = games.find((g) => g.game_no === previewNo) ?? null;

  const act = (kind: "assign" | "publish", game: AdminGame) => {
    startTransition(async () => {
      const res =
        kind === "assign"
          ? await assignDigits(game.id)
          : await publishDigits(game.id);
      if (res.ok) {
        toast.success(
          kind === "assign"
            ? `${gameCode(game.game_no)}: digits assigned — preview, then publish when ready.`
            : `${gameCode(game.game_no)}: digits are live for the players.`,
        );
        setConfirm(null);
        if (kind === "assign") setPreviewNo(game.game_no);
      } else {
        toast.error(res.error);
        setConfirm(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Digits</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Assign randomizes both axes — every digit exactly once, immutable
          forever. Publishing is the separate, deliberate step that shows them
          to the players.
        </p>
      </div>

      <div className="space-y-2">
        {games.map((g) => {
          const canAssign =
            !g.digits_assigned_at &&
            g.date_confirmed &&
            g.kickoff_at !== null &&
            new Date(g.kickoff_at) > new Date() &&
            g.status !== "void";
          const blockReason = !g.date_confirmed
            ? "date unconfirmed"
            : !g.kickoff_at
              ? "no kickoff time"
              : new Date(g.kickoff_at) <= new Date()
                ? "past kickoff"
                : g.status === "void"
                  ? "void"
                  : null;
          return (
            <div
              key={g.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface px-3 py-2.5"
            >
              <span className="w-9 text-sm font-semibold" data-numeric>
                {gameCode(g.game_no)}
              </span>
              <span className="w-24 text-sm">
                {matchupLabel(g.away_team, g.home_team)}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline" data-numeric>
                {fmtKickoffET(g.kickoff_at)}
              </span>
              <span className="flex-1" />
              {g.digits_published_at ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <Radio className="size-3.5" /> Published
                </span>
              ) : g.digits_assigned_at ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-halftime">
                  <Lock className="size-3.5" /> Assigned, not published
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {blockReason ? `No digits — ${blockReason}` : "No digits"}
                </span>
              )}
              {g.digits_assigned_at && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setPreviewNo(previewNo === g.game_no ? null : g.game_no)
                  }
                >
                  <Eye data-icon="inline-start" />
                  {previewNo === g.game_no ? "Hide" : "Preview"}
                </Button>
              )}
              {!g.digits_assigned_at && (
                <Button
                  size="sm"
                  disabled={!canAssign || pending}
                  onClick={() => setConfirm({ kind: "assign", game: g })}
                >
                  <Dice5 data-icon="inline-start" />
                  Assign
                </Button>
              )}
              {g.digits_assigned_at && !g.digits_published_at && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirm({ kind: "publish", game: g })}
                >
                  Publish
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {preview && preview.row_digits && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold">
            {gameCode(preview.game_no)} preview
            {!preview.digits_published_at && (
              <span className="ml-2 text-xs font-normal text-halftime">
                only you can see this until you publish
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground" data-numeric>
            Home rows: {preview.row_digits.join(" ")} · Away cols:{" "}
            {preview.col_digits?.join(" ")}
          </p>
          <BlocksGrid
            game={asPublicGame(preview)}
            blocks={blocks}
            config={config}
            mode="fit"
          />
        </div>
      )}

      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.kind === "assign" ? "Assign digits" : "Publish digits"}
              {confirm ? ` — ${gameCode(confirm.game.game_no)}` : ""}
            </DialogTitle>
            <DialogDescription>
              {confirm?.kind === "assign"
                ? "Both axes get a fresh random permutation of 0–9. Digits are immutable once written — there is no re-roll."
                : "Players see the digits immediately, and scoring unlocks. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => confirm && act(confirm.kind, confirm.game)}
              className={cn(confirm?.kind === "publish" && "bg-emerald-600 hover:bg-emerald-600/80 text-white")}
            >
              {pending
                ? "Working…"
                : confirm?.kind === "assign"
                  ? "Assign digits"
                  : "Publish to players"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
