// Winner green — the ONLY green on the public grid. Two levels: a strong
// outline for the halftime winner, a full fill for the final winner. Pure
// module so the WCAG pairings are unit-testable (colors.test.ts).
import { bestTextOn } from "@/lib/nfl";

export const WIN_OUTLINE = "#34D399"; // halftime outline (emerald-400)
export const WIN_FILL = "#10B981"; // final fill (emerald-500)
export const WIN_OUTLINE_ON_FILL = "#A7F3D0"; // outline shade when both (emerald-200)
export const WIN_FILL_TEXT = bestTextOn(WIN_FILL); // computed, never hardcoded
export const BADGE_BG = "#0B0D0F"; // dark pill behind the halftime amount
export const BADGE_TEXT = "#6EE7B7"; // emerald-300 on the dark pill
