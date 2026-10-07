# TNF game-day email: retired template

Retired 2026-10-07. The game-day pack is rendered by `src/lib/email`, event
`game_day_g<NN>` (`src/lib/email/events/game-day.ts`), like every other TNF
email. There is no template file to fill any more, and nothing in this folder
is read by any code or routine.

The design-kit HTML that lived here (`tnf-game-day-email.html`, copied
2026-09-05) carried a logo, a hero, notes and Lock modules and a footer. The
one email shape set on 2026-10-07 allows none of those: one opening line, one
table, one next line, the sign-off. Its history is in git.

To render or draft the pack: `npm run game-day -- --game <N> --context <file>
--participants <file> [--upload] [--draft]`, where the context file is
`admin_email_context('game_day_g<NN>', '<ADMIN_EMAIL>')` from the Supabase
connector. See `scripts/game-day-pack.mts`.
