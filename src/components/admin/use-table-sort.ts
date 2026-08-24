"use client";

// F1: every admin table sorts and filters, with sort state persisted in the
// URL (?<prefix>=key.asc|key.desc) so a sorted view survives reload and can
// be shared. State applies after mount to keep server and client HTML
// identical on first paint.

import { useCallback, useEffect, useState } from "react";

export type SortDir = "asc" | "desc";

export interface TableSort<K extends string> {
  key: K;
  dir: SortDir;
}

function readFromUrl<K extends string>(
  param: string,
  valid: readonly K[],
): TableSort<K> | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get(param);
  if (!raw) return null;
  const [key, dir] = raw.split(".");
  if (!valid.includes(key as K)) return null;
  return { key: key as K, dir: dir === "desc" ? "desc" : "asc" };
}

export function useTableSort<K extends string>(
  validKeys: readonly K[],
  initial: TableSort<K>,
  param = "sort",
): [TableSort<K>, (key: K) => void] {
  const [sort, setSort] = useState<TableSort<K>>(initial);

  useEffect(() => {
    const fromUrl = readFromUrl(param, validKeys);
    if (fromUrl) setSort(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(
    (key: K) => {
      setSort((prev) => {
        const next: TableSort<K> =
          prev.key === key
            ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
            : { key, dir: "asc" };
        try {
          const url = new URL(window.location.href);
          url.searchParams.set(param, `${next.key}.${next.dir}`);
          window.history.replaceState(null, "", url);
        } catch {
          /* URL persistence is best effort */
        }
        return next;
      });
    },
    [param],
  );

  return [sort, toggle];
}

/** Comparator helper: strings case-insensitive, numbers numeric, nulls last. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}
