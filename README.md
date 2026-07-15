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
- On Windows, allow "Node.js JavaScript Runtime" through the firewall on **Private
  networks** if other kiosks/devices on the LAN need to reach this machine.
- PowerShell 5 tip: `&&` doesn't work; run `cd` and `node` as separate commands.

## Run the tests

```powershell
cd backend
node --test
```

46 tests cover the strength/timing engine, prize codes, session store, and full
HTTP + WebSocket integration (validation, rate limiting, event ordering, error paths).

## Project layout

```
backend/
  src/engine/     Day 1 — password strength scoring, crack timing, attempt timeline
  src/prize/      prizeCode.js — VB-XXXXXXXX code generation (see note below)
  src/server/     Day 2 — HTTP + WebSocket service, session store, rate limiter
  test/           node:test suites (no framework needed)
frontend/
  index.html      Day 2 — single-file kiosk UI (terminal animation, vault, confetti)
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

- **Dev 3 (prize ledger):** `backend/src/prize/prizeCode.js` is the contract-specified
  placeholder — synchronous `generatePrizeCode()` returning `VB-` + 8 uppercase
  alphanumerics, unique per process. Swap its internals for the real ledger call and
  keep the signature; the server only imports that one function.
- **Frontend rules:** all server-supplied strings must be rendered via `textContent`
  (never `innerHTML`) — already the case in `frontend/index.html`.
- **Editing conventions:** don't log or persist raw passwords anywhere, and treat
  `docs/api-contract.md` as locked — propose changes there first, then implement.

## Status

- **Day 1 done:** engine + unit tests, API contract locked.
- **Day 2 done:** backend service, terminal-animation frontend, prize code placeholder,
  integration tests, verified end-to-end.
- **Day 3 next:** component integration hardening, unusual-input testing, kiosk
  deployment scripts.
