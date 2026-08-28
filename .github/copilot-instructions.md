# TNF - Thursday Night Football Squares Pool

## Project Overview
Web app for an NFL squares/block pool. 100 blocks at $500 each with fixed payouts. Public-facing block grid, admin management, and payout tracking.

## Tech Stack
- Framework: Next.js 15 (App Router) + TypeScript
- Database: Supabase (PostgreSQL) - views like v_pot, v_public_blocks drive the UI
- Styling: Tailwind CSS (PostCSS)
- Testing: Vitest
- Linting: ESLint (flat config, eslint.config.mjs)

## Build & Test Commands
- npm run dev - local dev server
- npm run build - production build
- npm run test - run Vitest suite
- npm run lint - ESLint check

## Architecture Notes
- Supabase schema lives in /supabase/ - SQL migrations and RLS policies
- All money values are in whole dollars (no cents). Block price is $500.
- The pot view (v_pot) calculates total pot from sold blocks. Never hardcode pot totals.
- Block grid renders from v_public_blocks - do not compute block status client-side.
- Payouts are fixed and defined in spec docs (TNF_V2_SPEC.md, TNF_APP_BUILD_SPEC.md).

## Coding Conventions
- TypeScript strict mode. No any types.
- Server components by default; "use client" only for interactivity.
- Supabase queries go through server-side client, never expose service role key.
- All new API routes must have input validation.
- Test new features with Vitest before committing.

## What NOT To Do
- Do not expose Supabase service role credentials in client-side code
- Do not store financial logic in client components - all payout calculations server-side
- Do not round money values - they are already whole dollars
- Do not add authentication libraries without checking if Supabase Auth is sufficient
