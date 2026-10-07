// The only greeting is a first name, verbatim from the participant row, and
// only when it is certainly right. Anything doubtful gets no greeting at all:
// a wrong name costs more than a missing one.
//
// Omitted when: the address reaches anyone through a cc (the cc is a
// different person from the participant); the people it reaches have
// different first names; the name is not plainly "First Last" (one word, an
// "&", "and" or "/", a business name, a first token that is not a word).

import type { HolderPerson } from "./types.ts";

const ORG_WORDS = new Set(
  [
    "agency", "associates", "bar", "brothers", "bros", "co", "company", "construction",
    "contracting", "corp", "corporation", "delivery", "deli", "electric", "enterprises",
    "family", "group", "inc", "llc", "limo", "lumber", "partners", "plumbing", "poultry",
    "services", "team", "trust",
  ],
);

export function firstNameOf(fullName: string | null | undefined): string | null {
  const name = (fullName ?? "").trim();
  if (!name) return null;
  const words = name.split(/\s+/);
  if (words.length < 2) return null;
  if (words.some((w) => w === "&" || w.toLowerCase() === "and" || w.includes("/") || w.includes("&"))) return null;
  const first = words[0];
  if (!/^[A-Za-z][A-Za-z'-]*$/.test(first) || first.length < 2) return null;
  const last = words[words.length - 1].replace(/[.,]/g, "").toLowerCase();
  if (ORG_WORDS.has(last)) return null;
  return first;
}

export function greetingFor(people: HolderPerson[]): string | null {
  if (people.length === 0) return null;
  if (people.some((p) => p.via !== "primary")) return null;
  const names = people.map((p) => firstNameOf(p.full_name));
  if (names.some((n) => n === null)) return null;
  const distinct = new Set(names);
  return distinct.size === 1 ? (names[0] as string) : null;
}
