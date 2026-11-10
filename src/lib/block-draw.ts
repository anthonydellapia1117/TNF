// The random block draw (docs/BLOCK_ASSIGNMENT_POLICY.md, rule 2): a published
// seed string hashed with FNV-1a (32 bit) into a mulberry32 PRNG driving a
// Fisher-Yates shuffle of the free numbers. The i-th block placed takes the
// i-th number of the shuffle.
//
// block_draw_order() in migration 40 is the same function in SQL, and the
// database runs that one. This copy exists so a draw can be replayed from the
// seed and the free list in its audit row without a database, and both suites
// assert the same vector (tests/unit/block-draw.test.ts, tests/sql/28).
//
// Seeds are printable ASCII, so one character is one byte in Postgres and one
// UTF-16 unit here, and the two copies cannot read a seed differently.

const SEED_RE = /^[ -~]{1,200}$/;

export function assertSeed(seed: string): void {
  if (!SEED_RE.test(seed)) throw new Error("a draw seed is printable ASCII, 1 to 200 characters");
}

/** FNV-1a, 32 bit, over the seed's characters. */
export function fnv1a32(seed: string): number {
  assertSeed(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a 32-bit state, each call a float in [0, 1). */
export function mulberry32(state: number): () => number {
  let a = state | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The free numbers, shuffled by the seed. The input is not changed. */
export function drawOrder(seed: string, free: readonly number[]): number[] {
  const rand = mulberry32(fnv1a32(seed));
  const a = [...free];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
