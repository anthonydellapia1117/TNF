import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { blockPosition, gameCode, payoutCents } from "@/lib/pool";
import { teamInfo } from "@/lib/nfl";
import type { PoolConfig, PublicBlock, PublicGame } from "@/lib/types";

export const revalidate = 60;

// 1200x630 winner share card (spec 4.8): matchup, final score with the last
// digits emphasized, the winning block large, the winner's alias, the
// amount, and a miniature grid with the winning cell lit. Reads only the
// public projections — the card leaks nothing the grid doesn't.

const C = {
  bg: "#0B0D0F",
  surface: "#14171A",
  surface2: "#1C2024",
  border: "#262B31",
  text: "#E8EAED",
  muted: "#8A9099",
  halftime: "#F59E0B",
  final: "#FBBF24",
  accent: "#4F7CFF",
};

function Score({ value, color }: { value: number; color: string }) {
  const s = String(value);
  const head = s.slice(0, -1);
  const last = s.slice(-1);
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      {head && (
        <span style={{ fontSize: 96, fontWeight: 700, color, opacity: 0.55 }}>
          {head}
        </span>
      )}
      <span style={{ fontSize: 96, fontWeight: 700, color }}>{last}</span>
    </div>
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gameId: string; type: string }> },
) {
  const { gameId, type: rawType } = await params;
  const type = rawType.replace(/\.png$/, "");
  if (type !== "final" && type !== "halftime") {
    return new Response("type must be final or halftime", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const [{ data: game }, { data: blocks }, { data: config }] =
    await Promise.all([
      supabase
        .from("v_public_games")
        .select("*")
        .eq("id", gameId)
        .maybeSingle(),
      supabase.from("v_public_blocks").select("*"),
      supabase.from("config").select("*").eq("id", 1).single(),
    ]);

  if (!game) return new Response("game not found", { status: 404 });
  const g = game as PublicGame;
  const cfg = config as PoolConfig;

  const block = type === "final" ? g.final_block : g.halftime_block;
  const home = type === "final" ? g.final_home : g.halftime_home;
  const away = type === "final" ? g.final_away : g.halftime_away;
  if (block === null || home === null || away === null) {
    return new Response("not scored yet", { status: 404 });
  }

  const winner =
    ((blocks ?? []) as PublicBlock[]).find((b) => b.block_number === block)
      ?.display_name ?? "Unclaimed";
  const amount = payoutCents(g.game_type, type, cfg);
  const amountLabel = `$${(amount / 100).toLocaleString("en-US")}`;
  const pos = blockPosition(block);
  const awayInfo = teamInfo(g.away_team);
  const homeInfo = teamInfo(g.home_team);
  const winColor = type === "final" ? C.final : C.halftime;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: C.bg,
          color: C.text,
          padding: 48,
          fontFamily: "sans-serif",
        }}
      >
        {/* Left: the story */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            paddingRight: 40,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 22,
                color: C.muted,
              }}
            >
              <span style={{ color: C.text, fontWeight: 700 }}>
                {gameCode(g.game_no)}
              </span>
              {g.holiday_label ? (
                <span style={{ color: "#C2410C", fontWeight: 700 }}>
                  {g.holiday_label.toUpperCase()}
                </span>
              ) : null}
              <span>1622 TNF Block Pool</span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 28,
              }}
            >
              <span style={{ fontSize: 30, fontWeight: 700, color: awayInfo.color }}>
                {g.away_team.toUpperCase()}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <Score value={away} color={C.text} />
                <span style={{ fontSize: 26, color: C.muted }}>at</span>
              </div>
              <span style={{ fontSize: 30, fontWeight: 700, color: homeInfo.color }}>
                {g.home_team.toUpperCase()}
              </span>
              <Score value={home} color={C.text} />
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <span
                style={{
                  fontSize: 26,
                  fontWeight: 800,
                  color: winColor,
                  letterSpacing: 2,
                }}
              >
                {type === "final" ? "🏆 FINAL" : "🥈 HALFTIME"}
              </span>
              <span style={{ fontSize: 26, color: C.muted }}>
                Block
              </span>
              <span style={{ fontSize: 44, fontWeight: 800, color: C.text }}>
                {block}
              </span>
            </div>
            <span
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: C.text,
                marginTop: 6,
              }}
            >
              {winner}
            </span>
            <span
              style={{
                fontSize: 54,
                fontWeight: 800,
                color: winColor,
                marginTop: 4,
              }}
            >
              {amountLabel}
            </span>
          </div>
        </div>

        {/* Right: miniature grid, winning cell lit */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: 16,
            backgroundColor: C.surface,
            borderRadius: 16,
            border: `1px solid ${C.border}`,
            alignSelf: "center",
          }}
        >
          {Array.from({ length: 10 }, (_, r) => (
            <div key={r} style={{ display: "flex", gap: 4 }}>
              {Array.from({ length: 10 }, (_, c) => {
                const isWin = r === pos.row && c === pos.col;
                const inLine = r === pos.row || c === pos.col;
                return (
                  <div
                    key={c}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 18,
                      fontWeight: isWin ? 800 : 400,
                      color: isWin ? "#000000" : C.muted,
                      backgroundColor: isWin
                        ? winColor
                        : inLine
                          ? "#2A2517"
                          : C.surface2,
                      border: `1px solid ${isWin ? winColor : C.border}`,
                    }}
                  >
                    {isWin ? block : ""}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
