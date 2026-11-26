import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/env";
import { gridImageModel, type GridImageModel } from "@/lib/grid-image";
import { teamPalette } from "@/lib/nfl";
import type { PublicBlock, PublicGame } from "@/lib/types";

// The grid as a picture, Comfortable view (Anthony, 2026-11-25, Part R): the
// block number in each corner, the name the board shows in the middle, the
// published digits on both axes, AWAY down the left and HOME across the top,
// the same orientation as /grid. The game-day email carries one of these per
// game, fetched at send time, so it reads the same rows the live grid reads.
// Public projections only: no email, no phone, no money.
//
//   GET /api/grid-image?g=2   PNG, 200 on a published game
//                             400 no or bad g, 404 no such game,
//                             409 the digits are not published

export const dynamic = "force-dynamic";

const W = 1540;
const RAIL = 64;
const DIGIT = 64;
const CELL = 134;
const CELL_H = 92;
const TITLE_H = 62;
const BAR_H = 54;
const DIGIT_H = 54;
const GAP = 4;
const H = TITLE_H + BAR_H + DIGIT_H + 10 * (CELL_H + GAP) + 20;

const C = {
  bg: "#0B0D0F",
  surface: "#1C2024",
  border: "#2E343B",
  text: "#E8EAED",
  muted: "#9AA1AA",
};

function Picture({ m }: { m: GridImageModel }) {
  const away = teamPalette(m.rowTeam).bar;
  const home = teamPalette(m.colTeam).bar;
  const rows = Array.from({ length: 10 }, (_, r) => r);
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, color: C.text, padding: 10 }}>
      <div style={{ display: "flex", height: TITLE_H, alignItems: "center", justifyContent: "space-between", padding: "0 6px" }}>
        <div style={{ display: "flex", fontSize: 34 }}>{`${m.code}  ${m.rowTeam} at ${m.colTeam}`}</div>
        <div style={{ display: "flex", fontSize: 22, color: C.muted }}>1622 TNF  ad-26-tnf.vercel.app/grid</div>
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {/* Away rail: the team name, rotated, down the left side. */}
        <div
          style={{
            display: "flex",
            width: RAIL,
            marginTop: BAR_H + DIGIT_H + GAP,
            height: 10 * (CELL_H + GAP) - GAP,
            alignItems: "center",
            justifyContent: "center",
            background: away.bg,
            borderRadius: 8,
            marginRight: GAP,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 10 * (CELL_H + GAP),
              height: RAIL,
              flexShrink: 0,
              whiteSpace: "nowrap",
              alignItems: "center",
              justifyContent: "center",
              transform: "rotate(-90deg)",
              color: away.fg,
              fontSize: 26,
              letterSpacing: 4,
            }}
          >{`AWAY  ${m.rowTeam.toUpperCase()}`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              height: BAR_H,
              marginLeft: DIGIT + GAP,
              width: 10 * (CELL + GAP) - GAP,
              alignItems: "center",
              justifyContent: "center",
              background: home.bg,
              color: home.fg,
              fontSize: 26,
              letterSpacing: 4,
              borderRadius: 8,
              marginBottom: GAP,
            }}
          >{`HOME  ${m.colTeam.toUpperCase()}`}</div>
          <div style={{ display: "flex", flexDirection: "row", height: DIGIT_H, marginBottom: GAP }}>
            <div style={{ display: "flex", width: DIGIT, marginRight: GAP }} />
            {m.colDigits.map((d, c) => (
              <div
                key={c}
                style={{
                  display: "flex",
                  width: CELL,
                  height: DIGIT_H,
                  marginRight: c < 9 ? GAP : 0,
                  alignItems: "center",
                  justifyContent: "center",
                  background: home.bg,
                  color: home.fg,
                  fontSize: 38,
                  borderRadius: 6,
                }}
              >
                {d}
              </div>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r} style={{ display: "flex", flexDirection: "row", marginBottom: r < 9 ? GAP : 0 }}>
              <div
                style={{
                  display: "flex",
                  width: DIGIT,
                  height: CELL_H,
                  marginRight: GAP,
                  alignItems: "center",
                  justifyContent: "center",
                  background: away.bg,
                  color: away.fg,
                  fontSize: 42,
                  borderRadius: 6,
                }}
              >
                {m.rowDigits[r]}
              </div>
              {m.cells
                .filter((cell) => cell.row === r)
                .map((cell) => (
                  <div
                    key={cell.n}
                    style={{
                      display: "flex",
                      position: "relative",
                      width: CELL,
                      height: CELL_H,
                      marginRight: cell.col < 9 ? GAP : 0,
                      alignItems: "center",
                      justifyContent: "center",
                      background: C.surface,
                      border: `2px solid ${C.border}`,
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ display: "flex", position: "absolute", top: 3, left: 8, fontSize: 19, color: C.muted }}>{cell.n}</div>
                    <div
                      style={{
                        display: "flex",
                        width: CELL - 12,
                        maxHeight: CELL_H - 26,
                        marginTop: 14,
                        justifyContent: "center",
                        textAlign: "center",
                        fontSize: 21,
                        lineHeight: 1.1,
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}
                    >
                      {cell.name ?? "open"}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export async function GET(req: Request) {
  const g = Number(new URL(req.url).searchParams.get("g"));
  if (!Number.isInteger(g) || g < 1) return new Response("g must be a game number", { status: 400 });
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const [games, blocks] = await Promise.all([
    supabase.from("v_public_games").select("*").eq("game_no", g).maybeSingle(),
    supabase.from("v_public_blocks").select("*").order("block_number"),
  ]);
  if (games.error || blocks.error) return new Response("could not read the board", { status: 502 });
  if (!games.data) return new Response("no such game", { status: 404 });
  let model: GridImageModel;
  try {
    model = gridImageModel(games.data as PublicGame, (blocks.data ?? []) as PublicBlock[]);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "digits not published", { status: 409 });
  }
  return new ImageResponse(<Picture m={model} />, {
    width: W,
    height: H,
    headers: { "cache-control": "no-store" },
  });
}
