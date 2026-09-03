import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { fmtKickoffET } from "@/lib/format";
import { teamInfo } from "@/lib/nfl";
import { committedBlocks, gameCode } from "@/lib/pool";
import { isSeasonMode } from "@/lib/season-mode";
import { currentGame } from "@/lib/data/public";
import type { PoolConfig, PublicGame } from "@/lib/types";

export const revalidate = 300;

// 1200x630 site-wide link preview, generated from live state.
//
// Off-season it shows the sales pressure — blocks open out of 100 — beside
// the next matchup. In season mode the big number becomes the game itself:
// this image is what 133 people see attached to the link on a game-day
// morning, and "51 BLOCKS OPEN" at 160px is the last thing that should
// greet them. Never the pool total, never money owed: it reads only the
// same public projections the dashboard does.

const C = {
  bg: "#0B0D0F",
  surface: "#14171A",
  border: "#262B31",
  text: "#E8EAED",
  muted: "#8A9099",
  accent: "#4F7CFF",
};

interface Pot {
  committed_blocks: number;
}

export async function GET() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const [{ data: games }, { data: pot }, { data: config }] = await Promise.all([
    supabase.from("v_public_games").select("*").order("game_no"),
    supabase.from("v_pot").select("committed_blocks").single(),
    supabase.from("config").select("*").eq("id", 1).single(),
  ]);

  const cfg = config as PoolConfig;
  const committed = committedBlocks({
    committed_blocks: (pot as Pot | null)?.committed_blocks ?? 0,
  });
  const open = Math.max(0, cfg.blocks_total - committed);
  const next = currentGame((games ?? []) as PublicGame[]);
  const away = next ? teamInfo(next.away_team) : null;
  const home = next ? teamInfo(next.home_team) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: C.bg,
          color: C.text,
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontSize: 40, fontWeight: 800, color: C.accent }}>
            1622
          </span>
          <span style={{ fontSize: 40, fontWeight: 700 }}>TNF BLOCK POOL</span>
          <span style={{ fontSize: 40, fontWeight: 400, color: C.muted }}>
            2026
          </span>
        </div>

        {/* The headline: the game in season mode, blocks open before it. */}
        {isSeasonMode(cfg) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: C.muted }}>
              {next ? `${gameCode(next.game_no)} · THIS WEEK` : "2026 SEASON"}
            </span>
            <span style={{ fontSize: 96, fontWeight: 800, lineHeight: 1 }}>
              {next ? "GAME DAY" : "23 GAMES"}
            </span>
            <span style={{ fontSize: 32, color: C.muted }}>
              100 blocks · fixed payouts · check the grid
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            <span style={{ fontSize: 160, fontWeight: 800, lineHeight: 1 }}>
              {open}
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 52, fontWeight: 700 }}>BLOCKS OPEN</span>
              <span style={{ fontSize: 32, color: C.muted }}>
                of {cfg.blocks_total}
              </span>
            </span>
          </div>
        )}

        {/* Next game in team colors */}
        {next && away && home ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              backgroundColor: C.surface,
              border: `1px solid ${C.border}`,
              borderRadius: 16,
              padding: "24px 32px",
            }}
          >
            <span style={{ fontSize: 26, color: C.muted }}>
              {gameCode(next.game_no)}
              {next.holiday_label ? ` · ${next.holiday_label}` : ""} ·{" "}
              {fmtKickoffET(next.kickoff_at)}
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
              <span style={{ fontSize: 44, fontWeight: 700, color: away.color }}>
                {next.away_team.toUpperCase()}
              </span>
              <span style={{ fontSize: 28, color: C.muted }}>at</span>
              <span style={{ fontSize: 44, fontWeight: 700, color: home.color }}>
                {next.home_team.toUpperCase()}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 30, color: C.muted }}>
            100 blocks · 23 games · every Thursday night
          </div>
        )}
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
