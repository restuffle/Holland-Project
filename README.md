# Operation: Vault Breach

Interactive cybersecurity awareness kiosk ("Password Defense Lab"). Students create a
sample password (max 6 chars), watch a simulated terminal-style "crack" of it, then get
educational feedback and a prize code. See `PLAN.md` for the full concept and
`docs/api-contract.md` for the locked API between backend and frontend.

> This is an educational **simulation** — no real password cracking happens. Passwords
> are used in-memory to compute a difficulty plan and are never stored or logged.

## Requirements

- **Node.js 18+** (LTS from https://nodejs.org). That's it — **zero npm dependencies**,
  no build step. The WebSocket layer is implemented with Node built-ins
  (`backend/src/server/wsFrames.js`), which suits the offline event-LAN deployment.

## Run it

```powershell
cd backend
node src\server\index.js
```

(macOS/Linux: `node src/server/index.js`, or `npm start`.)

Then open **http://localhost:3000** — the backend serves the frontend itself.

- `PORT` env var changes the port (default 3000).
- `ADMIN_TOKEN` env var sets the prize-desk admin token; if unset, a random one is
  generated at startup and printed to the console — give it to prize-table staff only.
- On Windows, allow "Node.js JavaScript Runtime" through the firewall on **Private
  networks** if other kiosks/devices on the LAN need to reach this machine.
- PowerShell 5 tip: `&&` doesn't work; run `cd` and `node` as separate commands.

## Run the tests

```powershell
cd backend
node --test
```

102 tests cover the strength/timing/mask engine, prize ledger + admin dashboard,
session store, and full HTTP + WebSocket integration (validation, rate limiting,
admin auth, event ordering, error paths, and the XSS/script-spam/all-same-char/
symbol-soup exploit-playtest scenarios).

## Project layout

```
backend/
  src/engine/     Day 1 — password strength scoring, crack timing, mask/attempt timeline
  src/prize/      prizeLedger.js — real prize ledger (redeem/leaderboard/ledger)
  src/server/     Day 2 — HTTP + WebSocket service, session store, rate limiter,
                  admin-token auth for /admin/*
  test/           node:test suites (no framework needed)
frontend/
  index.html      Day 2 — single-file kiosk UI (terminal animation, vault, confetti)
  admin.html      Day 2 — prize-desk staff dashboard (redeem codes, leaderboard, ledger)
docs/
  api-contract.md THE source of truth for backend<->frontend shapes and behavior
PLAN.md           Concept, educational goals, team roles, day-by-day timeline
```

## How it works (30 seconds)

1. `POST /api/sessions` with `{ "password": "..." }` → engine computes a crack *plan*
   (score, entropy, stages, target duration 8–55s); password is discarded immediately.
   Response: `{ sessionId, plan }`.
2. Frontend opens `ws://host/ws/sessions/:sessionId` → server streams `stage` and
   `attempt` events paced against the plan, ending with one `result` event carrying the
   prize code. Every run is a guaranteed win by design.
3. Sessions are in-memory only: 5-minute TTL, discarded on disconnect, one connection
   per session. Error cases arrive as a JSON message + WS close code (4404/4409) —
   see the contract doc for exact shapes.

## Team notes

- **Dev 3 (prize ledger):** `backend/src/prize/prizeLedger.js` is the real ledger —
  `generatePrizeCode`, `redeemCode` (blocks double-redemption), `getLedger`,
  `getLeaderboard`. `prizeCode.js` now just re-exports it for backward compatibility.
  Staff-facing dashboard is `frontend/admin.html`, served at `/admin.html`, gated by
  the `ADMIN_TOKEN` (see "Run it" above).
- **Frontend rules:** all server-supplied strings must be rendered via `textContent`
  (never `innerHTML`) — already the case in `frontend/index.html` and `admin.html`.
- **Editing conventions:** don't log or persist raw passwords anywhere, and treat
  `docs/api-contract.md` as locked — propose changes there first, then implement.

## Status

- **Day 1 done:** engine + unit tests, API contract locked.
- **Day 2 done:** backend service, terminal-animation frontend, prize ledger + admin
  dashboard (Dev 3), integration tests, verified end-to-end.
- **Day 3 done:** WS frame memory-exhaustion DoS fix from security playtest; mask/
  pattern pass rebuilt to be structural (real per-position class template, not a
  random word); exploit-playtest regression tests committed (XSS-in-field, script-
  spam, all-same-char, symbol-soup); admin-route auth gap found and fixed
  (`/admin/*` now requires `ADMIN_TOKEN`, previously wide open on the venue LAN).
- **Day 4 next:** kiosk multi-station deployment scripts, cross-browser/device pass,
  on-site troubleshooting runbook, on-site rehearsal (all still unbuilt — Dev 4 scope).
