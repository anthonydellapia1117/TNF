import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // The grid picture route (Part R) is a .tsx file: its JSX is compiled here
  // the way Next compiles it, not left for the tsconfig's preserve.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
