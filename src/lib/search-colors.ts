// The /grid search highlight (Part Q): the whole block fills yellow with a
// darker border, so a matched block reads outdoors on a phone. Yellow is not a
// winner colour; green stays the only winner colour on the grid, and a matched
// winning block keeps its green fill with this border round it.
import { bestTextOn } from "@/lib/nfl";

export const SEARCH_FILL = "#FACC15"; // yellow-400
export const SEARCH_BORDER = "#854D0E"; // yellow-800
export const SEARCH_FILL_TEXT = bestTextOn(SEARCH_FILL); // computed, never hardcoded
