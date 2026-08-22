"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCheck2, CalendarClock, Lock } from "lucide-react";
import { fmtKickoffET } from "@/lib/format";
import { gameCode } from "@/lib/pool";
import { matchupLabel, NFL_TEAMS } from "@/lib/nfl";
import type { AdminGame, GameType } from "@/lib/types";
import { updateGame } from "@/app/admin/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ET = "America/New_York";
const TEAM_NAMES = Object.keys(NFL_TEAMS);
const CUSTOM = "__custom__";

/**
 * Kickoffs are entered as ET wall-clock (two explicit fields — date + time —
 * instead of datetime-local, which the browser would interpret in the phone's
 * local zone). We compose the ISO string with a fixed offset: the season runs
 * Sep–Jan, Eastern Daylight Time (-04:00) covers Sep–Oct, and DST ends
 * Nov 1 2026 at 2:00 AM ET, so Nov–Jan games are Eastern Standard (-05:00).
 * No TNF game kicks off in the 1–2 AM changeover window, so date alone
 * decides the offset.
 */
function etOffset(ymd: string): string {
  const month = Number(ymd.slice(5, 7));
  return month >= 9 && month <= 10 ? "-04:00" : "-05:00";
}

/** Stored UTC ISO → ET wall-clock parts to prefill the date/time inputs. */
function etParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString("en-CA", { timeZone: ET }),
    time: d.toLocaleTimeString("en-GB", {
      timeZone: ET,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }),
  };
}

export function GamesClient({ games }: { games: AdminGame[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AdminGame | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  function openEdit(g: AdminGame) {
    setEditing(g);
    setDialogOpen(true);
  }

  /** The high-frequency one-tap: existing values + dateConfirmed true. */
  function confirmDate(g: AdminGame) {
    startTransition(async () => {
      const result = await updateGame({
        gameId: g.id,
        week: g.week,
        kickoffAt: g.kickoff_at,
        dateConfirmed: true,
        gameType: g.game_type,
        holidayLabel: g.holiday_label ?? "",
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        network: g.network ?? "",
        notes: g.notes ?? "",
      });
      if (result.ok) {
        toast.success(`${gameCode(g.game_no)} date confirmed.`);
        router.refresh();
      } else {
        toast.error(result.error ?? "Confirm failed.");
      }
    });
  }

  const confirmed = games.filter((g) => g.date_confirmed).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl">Games</h1>
        <p className="mt-0.5 text-sm text-muted-foreground" data-numeric>
          {games.length} games · {confirmed} dates confirmed. Tap a row to edit.
        </p>
      </div>

      <div className="space-y-2">
        {games.map((g) => (
          <div
            key={g.id}
            role="button"
            tabIndex={0}
            onClick={() => openEdit(g)}
            onKeyDown={(e) => {
              if (e.key === "Enter") openEdit(g);
            }}
            className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors duration-150 hover:bg-surface-2"
          >
            <span className="w-9 text-sm font-semibold" data-numeric>
              {gameCode(g.game_no)}
            </span>
            <span
              className="w-11 text-xs text-muted-foreground"
              data-numeric
            >
              Wk {g.week}
            </span>
            <span className="w-24 text-sm font-medium">
              {matchupLabel(g.away_team, g.home_team)}
            </span>
            <span className="text-xs text-muted-foreground" data-numeric>
              {fmtKickoffET(g.kickoff_at)}
            </span>
            {g.network && (
              <span className="hidden text-xs text-muted-foreground md:inline">
                {g.network}
              </span>
            )}
            {g.game_type === "holiday" && (
              <Badge
                variant="outline"
                className="border-holiday/50 text-holiday"
              >
                {g.holiday_label || "Holiday"}
              </Badge>
            )}
            {g.digits_assigned_at && (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <Lock className="size-3" /> digits locked
              </span>
            )}
            <span className="flex-1" />
            <span className="hidden text-2xs tracking-widest text-muted-foreground uppercase sm:inline">
              {g.status.replace(/_/g, " ")}
            </span>
            {g.date_confirmed ? (
              <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 text-xs font-medium text-emerald-400 sm:h-7">
                <CalendarCheck2 className="size-3.5" /> Confirmed
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDate(g);
                }}
                className="h-9 shrink-0 border border-halftime/40 bg-halftime/10 text-halftime hover:bg-halftime/20 sm:h-7"
              >
                <CalendarClock data-icon="inline-start" />
                Confirm date
              </Button>
            )}
          </div>
        ))}
      </div>

      <GameDialog
        game={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

interface GameForm {
  week: string;
  date: string;
  time: string;
  away_team: string;
  home_team: string;
  network: string;
  game_type: GameType;
  holiday_label: string;
  date_confirmed: boolean;
  notes: string;
}

const BLANK: GameForm = {
  week: "",
  date: "",
  time: "",
  away_team: "",
  home_team: "",
  network: "",
  game_type: "regular",
  holiday_label: "",
  date_confirmed: false,
  notes: "",
};

function GameDialog({
  game,
  open,
  onOpenChange,
}: {
  game: AdminGame | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<GameForm>(BLANK);

  useEffect(() => {
    if (!open || !game) return;
    const { date, time } = etParts(game.kickoff_at);
    setForm({
      week: String(game.week),
      date,
      time,
      away_team: game.away_team,
      home_team: game.home_team,
      network: game.network ?? "",
      game_type: game.game_type,
      holiday_label: game.holiday_label ?? "",
      date_confirmed: game.date_confirmed,
      notes: game.notes ?? "",
    });
  }, [open, game]);

  function set<K extends keyof GameForm>(key: K, value: GameForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!game) return;
    const week = parseInt(form.week, 10);
    if (!Number.isInteger(week) || week < 1) {
      toast.error("Week must be a positive number.");
      return;
    }
    if (!form.away_team.trim() || !form.home_team.trim()) {
      toast.error("Both teams are required.");
      return;
    }
    if ((form.date === "") !== (form.time === "")) {
      toast.error("Set both date and time ET — or clear both for TBD.");
      return;
    }
    const kickoffAt =
      form.date && form.time
        ? `${form.date}T${form.time}:00${etOffset(form.date)}`
        : null;
    startTransition(async () => {
      const result = await updateGame({
        gameId: game.id,
        week,
        kickoffAt,
        dateConfirmed: form.date_confirmed,
        gameType: form.game_type,
        holidayLabel:
          form.game_type === "holiday" ? form.holiday_label.trim() : "",
        homeTeam: form.home_team.trim(),
        awayTeam: form.away_team.trim(),
        network: form.network.trim(),
        notes: form.notes.trim(),
      });
      if (result.ok) {
        toast.success(`Saved ${gameCode(game.game_no)}`);
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "Save failed.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        {game && (
          <>
            <DialogHeader>
              <DialogTitle>
                Edit {gameCode(game.game_no)} ·{" "}
                {matchupLabel(game.away_team, game.home_team)}
              </DialogTitle>
              <DialogDescription data-numeric>
                Stored kickoff: {fmtKickoffET(game.kickoff_at)}
              </DialogDescription>
            </DialogHeader>

            {game.digits_assigned_at && (
              <p className="flex items-center gap-1.5 rounded-md border border-halftime/40 bg-halftime/10 px-2.5 py-1.5 text-xs text-halftime">
                <Lock className="size-3.5 shrink-0" />
                Digits locked — teams and dates can still change; digits never
                do.
              </p>
            )}

            <form onSubmit={save} className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="g-week">Week</Label>
                <Input
                  id="g-week"
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.week}
                  onChange={(e) => set("week", e.target.value)}
                  data-numeric
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="g-network">Network</Label>
                <Input
                  id="g-network"
                  value={form.network}
                  onChange={(e) => set("network", e.target.value)}
                  autoComplete="off"
                  placeholder="Prime Video"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="g-date">Date</Label>
                <Input
                  id="g-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  data-numeric
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="g-time">Time (ET)</Label>
                <Input
                  id="g-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => set("time", e.target.value)}
                  data-numeric
                />
              </div>

              <TeamField
                id="g-away"
                label="Away team"
                value={form.away_team}
                onChange={(v) => set("away_team", v)}
              />

              <TeamField
                id="g-home"
                label="Home team"
                value={form.home_team}
                onChange={(v) => set("home_team", v)}
              />

              <div className="space-y-1.5">
                <Label htmlFor="g-type">Type</Label>
                <Select
                  value={form.game_type}
                  onValueChange={(v) => set("game_type", v as GameType)}
                >
                  <SelectTrigger id="g-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">Regular</SelectItem>
                    <SelectItem value="holiday">Holiday</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.game_type === "holiday" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="g-holiday">Holiday label</Label>
                  <Input
                    id="g-holiday"
                    value={form.holiday_label}
                    onChange={(e) => set("holiday_label", e.target.value)}
                    autoComplete="off"
                    placeholder="Thanksgiving"
                  />
                </div>
              ) : (
                <div />
              )}

              <label
                htmlFor="g-confirmed"
                className="col-span-2 flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface-2/50 px-3 py-2.5 text-sm"
              >
                <Checkbox
                  id="g-confirmed"
                  checked={form.date_confirmed}
                  onCheckedChange={(v) => set("date_confirmed", v === true)}
                />
                Date confirmed — the league won&apos;t flex it
              </label>

              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="g-notes">Notes</Label>
                <textarea
                  id="g-notes"
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  rows={2}
                  className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                />
              </div>

              <DialogFooter className="col-span-2 mt-1">
                <DialogClose asChild>
                  <Button type="button" variant="outline" disabled={pending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save game"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Team picker: the 32 real names in a select, with a free-text fallback that
 * appears whenever the value isn't one of them (TBD, blank, or anything odd).
 * Stateless — the mode is derived from the value itself.
 */
function TeamField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const known = value in NFL_TEAMS;
  return (
    <div className="col-span-2 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={known ? value : CUSTOM}
        onValueChange={(v) => onChange(v === CUSTOM ? (known ? "" : value) : v)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TEAM_NAMES.map((t) => (
            <SelectItem key={t} value={t}>
              {t}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>Other / TBD…</SelectItem>
        </SelectContent>
      </Select>
      {!known && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Team name"
          autoComplete="off"
          aria-label={`${label} (free text)`}
        />
      )}
    </div>
  );
}
