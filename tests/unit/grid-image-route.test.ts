// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";

// Part R: the route that draws the game-day email's grid picture. Supabase is
// replaced by the board as the public projections return it, so this runs the
// real route and the real renderer and checks the PNG that comes out.
const NAMES: Record<number, string> = { 3: "AAA", 12: "Philadelphia Poultry", 23: "PAAA M", 37: "Mario Tropea Jr.", 94: "PRESTIGE PULLZ" };
const ROWS = [4, 0, 7, 1, 9, 2, 8, 5, 3, 6];
const COLS = [2, 9, 0, 6, 3, 8, 1, 7, 5, 4];
const GAMES = [
  { game_no: 2, away_team: "Chicago Bears", home_team: "Detroit Lions", row_digits: ROWS, col_digits: COLS, digits_published_at: "2026-11-26T14:10:00+00:00" },
  { game_no: 3, away_team: "Philadelphia Eagles", home_team: "Dallas Cowboys", row_digits: COLS, col_digits: ROWS, digits_published_at: "2026-11-26T14:10:00+00:00" },
  { game_no: 5, away_team: "Denver Broncos", home_team: "Pittsburgh Steelers", row_digits: null, col_digits: null, digits_published_at: null },
];
const BLOCKS = Array.from({ length: 100 }, (_, i) => ({ block_number: i + 1, status: "assigned", display_name: NAMES[i + 1] ?? `Name ${i + 1}` }));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_c: string, v: number) => ({ maybeSingle: async () => ({ data: GAMES.find((g) => g.game_no === v) ?? null, error: null }) }),
        order: async () => ({ data: table === "v_public_blocks" ? BLOCKS : [], error: null }),
      }),
    }),
  }),
}));

import { GET } from "@/app/api/grid-image/route";

const req = (g: string) => new Request(`http://localhost/api/grid-image${g ? `?g=${g}` : ""}`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("GET /api/grid-image", () => {
  it("draws a published game as a PNG wide enough to read 100 names", async () => {
    const res = await GET(req("2"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const b = Buffer.from(await res.arrayBuffer());
    expect(b.subarray(0, 8).equals(PNG)).toBe(true);
    expect(b.readUInt32BE(16)).toBeGreaterThanOrEqual(1200);
    expect(b.readUInt32BE(20)).toBeGreaterThanOrEqual(800);
    expect(b.length).toBeGreaterThan(50_000);
    if (process.env.GRID_IMAGE_OUT) writeFileSync(`${process.env.GRID_IMAGE_OUT}/g02.png`, b);
  });

  it("draws each published game of the day, each its own picture", async () => {
    const [a, b] = await Promise.all([GET(req("2")), GET(req("3"))]);
    const [ba, bb] = [Buffer.from(await a.arrayBuffer()), Buffer.from(await b.arrayBuffer())];
    expect(ba.equals(bb)).toBe(false);
    if (process.env.GRID_IMAGE_OUT) writeFileSync(`${process.env.GRID_IMAGE_OUT}/g03.png`, bb);
  });

  it("refuses a game whose digits are not published: 409, never a grid of question marks", async () => {
    const res = await GET(req("5"));
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/not published/);
  });

  it("400 for no game number or a bad one, 404 for a game that does not exist", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("abc"))).status).toBe(400);
    expect((await GET(req("0"))).status).toBe(400);
    expect((await GET(req("99"))).status).toBe(404);
  });
});
