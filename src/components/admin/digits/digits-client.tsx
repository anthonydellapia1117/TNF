"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Dice5, Eye, Lock, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  etDateOf,
  etWallClockToUtcISO,
  fmtKickoffET,
  REVEAL_TIME_ET,
} from "@/lib/format";
import { gameCode } from "@/lib/pool";
import { ASSIGN_WINDOW_DAYS, windowRefusal } from "@/lib/week-digits";
import { matchupLabel } from "@/lib/nfl";
import { assignDigits, publishDigits } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** Whether the digits have actually reached the players yet. */
function isRevealed(g: AdminGame): boolean {
  return (
    g.digits_published_at !== null &&
    new Date(g.digits_published_at) <= new Date()
  );
}

function isScheduled(g: AdminGame): boolean {
  return (
    g.digits_published_at !== null &&
    new Date(g.digits_published_at) > new Date()
  );
}

/** ET wall-clock parts of a stored instant, to prefill the schedule inputs. */
function etParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    time: d.toLocaleTimeString("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  };
}

type PublishMode = "now" | "schedule";

interface ConfirmState {
  kind: "assign" | "publish";
  game: AdminGame;
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
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [publishMode, setPublishMode] = useState<PublishMode>("now");
  const [schedDate, setSchedDate] = useState("");
  const [schedTime, setSchedTime] = useState(REVEAL_TIME_ET);
  const [pending, startTransition] = useTransition();

  const preview = games.find((g) => g.game_no === previewNo) ?? null;

  /** Open the publish dialog. Scheduled default: the standing slot on game date. */
  const openPublish = (game: AdminGame, mode: PublishMode) => {
    if (isScheduled(game) && game.digits_published_at) {
      const p = etParts(game.digits_published_at);
      setSchedDate(p.date);
      setSchedTime(mode === "schedule" ? p.time : REVEAL_TIME_ET);
    } else {
      setSchedDate(game.kickoff_at ? etDateOf(game.kickoff_at) : "");
      setSchedTime(REVEAL_TIME_ET);
    }
    setPublishMode(mode);
    setConfirm({ kind: "publish", game });
  };

  const scheduleISO =
    publishMode === "schedule" && schedDate && schedTime
      ? etWallClockToUtcISO(schedDate, schedTime)
      : null;
  const scheduleInFuture =
    scheduleISO !== null && new Date(scheduleISO) > new Date();

  const act = (kind: "assign" | "publish", game: AdminGame) => {
    startTransition(async () => {
      const res =
        kind === "assign"
          ? await assignDigits(game.id)
          : await publishDigits(game.id, scheduleISO);
      if (res.ok) {
        toast.success(
          kind === "assign"
            ? `${gameCode(game.game_no)}: digits assigned — preview, then publish when ready.`
            : scheduleISO
              ? `${gameCode(game.game_no)}: reveal scheduled for ${fmtKickoffET(scheduleISO)}. The site flips on its own — nothing else to do.`
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
        <h2 className="text-lg">Every game</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          The whole season, for one-off work: reschedule a reveal, publish one
          early, check a state. Assigning still randomizes both axes — every
          digit exactly once, immutable forever — and still obeys the one-week
          rule, so a game more than {ASSIGN_WINDOW_DAYS} days out cannot be
          drawn from here either. Until the reveal, the public grid keeps
          showing ? on both axes.
        </p>
      </div>

      <div className="space-y-2">
        {games.map((g) => {
          // The one-week rule is a rule, not a screen: the per-game draw asks
          // the same question the weekly screen does, so there is no way in
          // here to draw a game that is still months out.
          const tooEarly = windowRefusal(g, Date.now());
          const canAssign =
            !g.digits_assigned_at &&
            g.date_confirmed &&
            g.kickoff_at !== null &&
            new Date(g.kickoff_at) > new Date() &&
            g.status !== "void" &&
            tooEarly === null;
          const blockReason = !g.date_confirmed
            ? "date unconfirmed"
            : !g.kickoff_at
              ? "no kickoff time"
              : new Date(g.kickoff_at) <= new Date()
                ? "past kickoff"
                : g.status === "void"
                  ? "void"
                  : tooEarly
                    ? `outside the ${ASSIGN_WINDOW_DAYS}-day window`
                    : null;
          const revealed = isRevealed(g);
          const scheduled = isScheduled(g);
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
              {revealed ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <Radio className="size-3.5" /> Published
                </span>
              ) : scheduled ? (
                <span
                  className="inline-flex items-center gap-1.5 text-xs text-live"
                  data-numeric
                >
                  <CalendarClock className="size-3.5" /> Reveals{" "}
                  {fmtKickoffET(g.digits_published_at)}
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
              {g.digits_assigned_at && !revealed && !scheduled && (
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => openPublish(g, "now")}
                >
                  Publish
                </Button>
              )}
              {scheduled && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => openPublish(g, "schedule")}
                  >
                    Reschedule
                  </Button>
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() => openPublish(g, "now")}
                  >
                    Publish now
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {preview && preview.row_digits && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold">
            {gameCode(preview.game_no)} preview
            {!isRevealed(preview) && (
              <span className="ml-2 text-xs font-normal text-halftime">
                {isScheduled(preview)
                  ? `hidden from players until ${fmtKickoffET(preview.digits_published_at)}`
                  : "only you can see this until you publish"}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground" data-numeric>
            Away rows: {preview.row_digits.join(" ")} · Home cols:{" "}
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
                : "Choose when the players see the digits. Until the reveal time, the public grid keeps showing ? — the digits never leave the server."}
            </DialogDescription>
          </DialogHeader>

          {confirm?.kind === "publish" && (
            <div className="space-y-2">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  publishMode === "now"
                    ? "border-emerald-500/50 bg-emerald-500/10"
                    : "border-border bg-surface-2/50",
                )}
              >
                <input
                  type="radio"
                  name="publish-mode"
                  checked={publishMode === "now"}
                  onChange={() => setPublishMode("now")}
                  className="mt-0.5 accent-emerald-500"
                />
                <span>
                  <span className="font-medium">Publish now</span>
                  <span className="block text-xs text-muted-foreground">
                    Digits go live immediately; scoring unlocks.
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  publishMode === "schedule"
                    ? "border-live/50 bg-live/10"
                    : "border-border bg-surface-2/50",
                )}
              >
                <input
                  type="radio"
                  name="publish-mode"
                  checked={publishMode === "schedule"}
                  onChange={() => setPublishMode("schedule")}
                  className="mt-0.5 accent-blue-500"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">Publish at a scheduled time</span>
                  <span className="block text-xs text-muted-foreground">
                    The reveal fires on its own — no further action needed.
                  </span>
                  {publishMode === "schedule" && (
                    <span className="mt-2 grid grid-cols-2 gap-2">
                      <span className="space-y-1">
                        <Label htmlFor="sched-date" className="text-xs">
                          Date
                        </Label>
                        <Input
                          id="sched-date"
                          type="date"
                          value={schedDate}
                          onChange={(e) => setSchedDate(e.target.value)}
                          data-numeric
                        />
                      </span>
                      <span className="space-y-1">
                        <Label htmlFor="sched-time" className="text-xs">
                          Time (ET)
                        </Label>
                        <Input
                          id="sched-time"
                          type="time"
                          value={schedTime}
                          onChange={(e) => setSchedTime(e.target.value)}
                          data-numeric
                        />
                      </span>
                      {scheduleISO && scheduleInFuture && (
                        <span
                          className="col-span-2 text-xs text-live"
                          data-numeric
                        >
                          Reveals {fmtKickoffET(scheduleISO)}
                        </span>
                      )}
                      {scheduleISO && !scheduleInFuture && (
                        <span className="col-span-2 text-xs text-destructive">
                          That time has already passed — pick a future time or
                          publish now.
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </label>
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                pending ||
                (confirm?.kind === "publish" &&
                  publishMode === "schedule" &&
                  !scheduleInFuture)
              }
              onClick={() => confirm && act(confirm.kind, confirm.game)}
              className={cn(
                confirm?.kind === "publish" &&
                  publishMode === "now" &&
                  "bg-emerald-600 hover:bg-emerald-600/80 text-white",
              )}
            >
              {pending
                ? "Working…"
                : confirm?.kind === "assign"
                  ? "Assign digits"
                  : publishMode === "schedule"
                    ? "Schedule the reveal"
                    : "Publish to players"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
