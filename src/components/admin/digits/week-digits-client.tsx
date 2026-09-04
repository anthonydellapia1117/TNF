"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, Dice5, Eye, Lock, Radio, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtKickoffET } from "@/lib/format";
import { gameCode } from "@/lib/pool";
import { matchupLabel } from "@/lib/nfl";
import {
  ASSIGN_WINDOW_DAYS,
  defaultWeek,
  digitState,
  weekPlans,
  type WeekPlan,
} from "@/lib/week-digits";
import { assignWeekDigits, scheduleWeekReveals } from "@/app/admin/actions";
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

function asPublicGame(g: AdminGame): PublicGame {
  return { ...g, digits_assigned: g.digits_assigned_at !== null };
}

type Confirming = "assign" | "publish" | null;

export function WeekDigitsClient({
  games,
  blocks,
  config,
}: {
  games: AdminGame[];
  blocks: PublicBlock[];
  config: PoolConfig;
}) {
  const [nowMs] = useState(() => Date.now());
  const plans = useMemo(() => weekPlans(games, nowMs), [games, nowMs]);
  const [week, setWeek] = useState<number | null>(() => defaultWeek(plans, nowMs));
  const [previewNo, setPreviewNo] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [pending, startTransition] = useTransition();

  const plan: WeekPlan | null = plans.find((p) => p.week === week) ?? null;
  const preview = plan?.games.find((g) => g.game_no === previewNo) ?? null;

  const run = (kind: "assign" | "publish") => {
    if (!plan) return;
    startTransition(async () => {
      const res =
        kind === "assign"
          ? await assignWeekDigits(plan.week)
          : await scheduleWeekReveals(plan.week);
      setConfirming(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (kind === "assign") {
        const nos = (res.data as { assigned: number[] }).assigned;
        toast.success(
          `Week ${plan.week}: digits drawn for ${nos.map(gameCode).join(", ")}. ` +
            `Review them, then publish as a separate step.`,
        );
      } else {
        const list = (res.data as {
          scheduled: { gameNo: number; atISO: string | null }[];
        }).scheduled;
        toast.success(
          `Week ${plan.week}: ${list
            .map(
              (s) =>
                `${gameCode(s.gameNo)} ${s.atISO ? fmtKickoffET(s.atISO) : "live now"}`,
            )
            .join(" · ")}. The reveals fire on their own.`,
        );
      }
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl">Digits — one week at a time</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          Digits are drawn for the games of a single week, the week they are
          needed. Each game gets its own independent permutation of both axes —
          no shared seed, no relationship to any other game or week. Drawing and
          publishing are separate steps: after the draw you review the numbers,
          and only a second deliberate click schedules the reveals, each at 8:00
          AM ET on that game&rsquo;s own date. A week whose games are more than{" "}
          {ASSIGN_WINDOW_DAYS} days out cannot be drawn at all.
        </p>
      </div>

      {/* Week selector. A dot marks a week that still has undrawn games. */}
      <div className="flex flex-wrap items-center gap-1">
        {plans.map((p) => {
          const undrawn = p.games.some((g) => g.digits_assigned_at === null);
          const active = p.week === week;
          return (
            <button
              key={p.week}
              onClick={() => {
                setWeek(p.week);
                setPreviewNo(null);
              }}
              className={cn(
                "relative rounded-md border px-2.5 py-1.5 text-sm transition-colors duration-150",
                active
                  ? "border-border bg-surface-2 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-numeric
            >
              {p.week}
              {undrawn && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-halftime" />
              )}
            </button>
          );
        })}
      </div>

      {plan && (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold">{plan.label}</h2>
            <span className="text-xs text-muted-foreground" data-numeric>
              {plan.games.length} game{plan.games.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="space-y-2">
            {plan.games.map((g) => {
              const state = digitState(g, nowMs);
              const blockedReason = plan.blocked.find(
                (b) => b.game.id === g.id,
              )?.reason;
              return (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5"
                >
                  <span className="w-9 text-sm font-semibold" data-numeric>
                    {gameCode(g.game_no)}
                  </span>
                  <span className="w-40 text-xs text-muted-foreground" data-numeric>
                    {fmtKickoffET(g.kickoff_at)}
                  </span>
                  <span className="w-24 text-sm">
                    {matchupLabel(g.away_team, g.home_team)}
                  </span>
                  {g.holiday_label && (
                    <span className="text-xs text-halftime">{g.holiday_label}</span>
                  )}
                  <span className="flex-1" />
                  {state === "revealed" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                      <Radio className="size-3.5" /> Published
                    </span>
                  ) : state === "scheduled" ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs text-live"
                      data-numeric
                    >
                      <CalendarClock className="size-3.5" /> Reveals{" "}
                      {fmtKickoffET(g.digits_published_at)}
                    </span>
                  ) : state === "assigned" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-halftime">
                      <Lock className="size-3.5" /> Drawn, not published
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {blockedReason ? `No digits — ${blockedReason}` : "No digits"}
                    </span>
                  )}
                  {g.row_digits && (
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
                </div>
              );
            })}
          </div>

          {/* Step 1 — draw. */}
          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={!plan.assign.ok || pending}
                onClick={() => setConfirming("assign")}
              >
                <Dice5 data-icon="inline-start" />
                {plan.toAssign.length > 0
                  ? `Assign digits for week ${plan.week} (${plan.toAssign.length} game${plan.toAssign.length === 1 ? "" : "s"})`
                  : `Assign digits for week ${plan.week}`}
              </Button>
              {plan.assign.ok && plan.toAssign.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {plan.toAssign.map((g) => gameCode(g.game_no)).join(", ")} — one
                  independent draw each.
                </span>
              )}
            </div>
            {!plan.assign.ok && (
              <p className="inline-flex max-w-2xl items-start gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-halftime" />
                <span data-numeric>{plan.assign.reason}</span>
              </p>
            )}
          </div>

          {/* Step 2 — review, then publish on a separate deliberate click. */}
          {plan.toSchedule.length > 0 && (
            <div className="space-y-3 border-t border-border pt-4">
              <p className="text-sm font-semibold">
                Review before publishing
                <span className="ml-2 text-xs font-normal text-halftime">
                  only you can see these
                </span>
              </p>
              <div className="space-y-1.5">
                {plan.toSchedule.map(({ game: g, revealAtISO, immediate }) => (
                  <div
                    key={g.id}
                    className="rounded-lg border border-border bg-surface-2/40 px-3 py-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold" data-numeric>
                        {gameCode(g.game_no)}
                      </span>
                      <span className="text-muted-foreground">
                        {matchupLabel(g.away_team, g.home_team)}
                      </span>
                      <span className="flex-1" />
                      <span className={immediate ? "text-halftime" : "text-live"} data-numeric>
                        {immediate
                          ? "8:00 AM ET has passed — publishes immediately"
                          : `Reveals ${fmtKickoffET(revealAtISO)}`}
                      </span>
                    </div>
                    <p className="mt-1.5 text-muted-foreground" data-numeric>
                      Away rows: {g.row_digits?.join(" ")} · Home cols:{" "}
                      {g.col_digits?.join(" ")}
                    </p>
                  </div>
                ))}
              </div>
              <Button
                disabled={pending}
                onClick={() => setConfirming("publish")}
                className="bg-emerald-600 text-white hover:bg-emerald-600/80"
              >
                Publish week {plan.week} — schedule{" "}
                {plan.toSchedule.length === 1
                  ? "the reveal"
                  : `${plan.toSchedule.length} reveals`}
              </Button>
            </div>
          )}
        </div>
      )}

      {preview && preview.row_digits && (
        <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <p className="text-sm font-semibold">
            {gameCode(preview.game_no)} preview
            {digitState(preview, nowMs) !== "revealed" && (
              <span className="ml-2 text-xs font-normal text-halftime">
                {digitState(preview, nowMs) === "scheduled"
                  ? `hidden from players until ${fmtKickoffET(preview.digits_published_at)}`
                  : "only you can see this until you publish"}
              </span>
            )}
          </p>
          <BlocksGrid
            game={asPublicGame(preview)}
            blocks={blocks}
            config={config}
            mode="fit"
          />
        </div>
      )}

      <Dialog
        open={confirming !== null}
        onOpenChange={(o) => !o && setConfirming(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirming === "assign"
                ? `Assign digits — week ${plan?.week}`
                : `Publish digits — week ${plan?.week}`}
            </DialogTitle>
            <DialogDescription>
              {confirming === "assign" ? (
                <>
                  {plan?.toAssign.map((g) => gameCode(g.game_no)).join(", ")} each
                  get a fresh random permutation of 0&ndash;9 on both axes, drawn
                  independently. Digits are immutable once written — there is no
                  re-roll. Nothing reaches the players until you publish.
                </>
              ) : (
                <>
                  Each reveal is scheduled for 8:00 AM ET on its own game&rsquo;s
                  date. Until then the public grid keeps showing ? and the digits
                  never leave the server. The reveals fire on their own.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {confirming === "publish" && plan && (
            <ul className="space-y-1 text-xs text-muted-foreground" data-numeric>
              {plan.toSchedule.map(({ game: g, revealAtISO, immediate }) => (
                <li key={g.id}>
                  {gameCode(g.game_no)} —{" "}
                  {immediate ? "immediately" : fmtKickoffET(revealAtISO)}
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => run(confirming === "assign" ? "assign" : "publish")}
              className={cn(
                confirming === "publish" &&
                  "bg-emerald-600 text-white hover:bg-emerald-600/80",
              )}
            >
              {pending
                ? "Working…"
                : confirming === "assign"
                  ? "Draw the digits"
                  : "Schedule the reveals"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
