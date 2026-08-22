"use client";

import { useEffect, useState } from "react";

// Which last digits have produced winners. Recharts is heavy, so it stays out
// of the initial bundle: the module loads dynamically after mount and a
// same-height skeleton holds the space until it lands.

type RechartsModule = typeof import("recharts");

// Chart internals draw into SVG attributes, where CSS variables don't
// resolve — these mirror the globals.css dark tokens.
const ACCENT = "#4F7CFF"; // --pool-accent
const MUTED = "#8A9099"; // --muted-foreground
const SURFACE_2 = "#1C2024"; // --surface-2
const BORDER = "#262B31"; // --border
const FOREGROUND = "#E8EAED"; // --foreground

export function HotDigits({ counts }: { counts: number[] }) {
  const hasData = counts.some((c) => c > 0);
  const [recharts, setRecharts] = useState<RechartsModule | null>(null);

  useEffect(() => {
    if (!hasData) return;
    let cancelled = false;
    import("recharts")
      .then((mod) => {
        if (!cancelled) setRecharts(mod);
      })
      .catch(() => {
        // Chunk failed to load — the skeleton stays, nothing breaks.
      });
    return () => {
      cancelled = true;
    };
  }, [hasData]);

  if (!hasData) {
    return (
      <p className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground">
        Digits start hitting when the first game is scored.
      </p>
    );
  }

  if (!recharts) {
    return <div className="h-48 w-full rounded-md bg-surface-2" aria-hidden />;
  }

  const { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } = recharts;
  const data = counts.map((count, digit) => ({ digit: String(digit), count }));

  return (
    <div className="h-48 w-full" data-numeric>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 4, bottom: 0, left: 4 }}
          barCategoryGap="25%"
        >
          <XAxis
            dataKey="digit"
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fill: MUTED, fontSize: 12 }}
          />
          <Tooltip
            cursor={{ fill: "rgba(255, 255, 255, 0.04)" }}
            labelFormatter={(label) => `Digit ${String(label)}`}
            contentStyle={{
              backgroundColor: SURFACE_2,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              fontSize: 12,
              padding: "6px 10px",
            }}
            labelStyle={{ color: FOREGROUND, fontWeight: 600 }}
            itemStyle={{ color: MUTED }}
          />
          <Bar
            dataKey="count"
            name="Winners"
            fill={ACCENT}
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
