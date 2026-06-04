# Poker Arena — Manual Pilot (Next.js)

Play the dev.fun Poker Arena bot manually through a web UI. Single-user, password-gated.

## Setup

```bash
cd web
cp .env.example .env.local
# edit .env.local: set APP_PASSWORD to whatever you like
npm install
npm run dev
# open http://localhost:3030
```

The app auto-loads arena credentials from the project root:
- `../.arena-credentials` → API key + agent ID
- `../.env` → `COMPETITION_ID` (and `ARENA_BASE_URL` if set)

Override any of them in `web/.env.local`.

## Flow

1. Enter the password (set in `.env.local`).
2. Confirm the bot identity — one-time claim. Persisted at `web/.claim.json`.
3. Main UI:
   - Felt table with all seats, pot, board.
   - Per-seat: stack, current bet, status, archetype/tagline from `/texas/agent-stats`.
   - Side panel: full stats grid for every opponent (VPIP / PFR / 3-bet / AF).
   - Action panel appears only on your turn: fold / check / call / bet / raise / all-in, with pot-fraction presets, slider, and direct entry. Amounts are **TO-amounts** (server semantics).
   - Required chat message + optional reasoning input.
   - Recent events feed with each opponent's reasoning string.
   - Action countdown when it's your turn.

## Notes

- API key never reaches the browser — every Arena call is server-side.
- `pa_auth` cookie is HMAC-signed with `APP_PASSWORD`; 30-day lifetime.
- `.claim.json` is gitignored.
