# Day 2 — Prize Ledger (Dev 3)

Replaces the placeholder `prizeCode.js` stub with a real in-memory prize ledger,
admin HTTP endpoints, a prize-table staff dashboard, and full test coverage.

---

## Files Changed

### `backend/src/prize/prizeCode.js` — replaced

Was a self-contained placeholder. Now a thin re-export of `prizeLedger.js` so all
existing import paths and function signatures stay unchanged.

---

## Files Created

### `backend/src/prize/prizeLedger.js`

The real ledger. All state is in-memory (no persistence across restarts, per the
architecture spec).

**Exports:**

| Function | Signature | Description |
|---|---|---|
| `generatePrizeCode` | `(meta?: { revealMs?: number }) → string` | Generates a unique `VB-XXXXXXXX` code and records it. Accepts optional crack duration for leaderboard tracking. |
| `redeemCode` | `(code: string) → { ok: true } \| { ok: false, error: string }` | Marks a code redeemed. Returns `already_redeemed` if scanned twice — prevents staff from issuing a second prize. Returns `unknown_code` if the code was never issued. |
| `getLedger` | `() → Entry[]` | All issued codes, newest first. Each entry includes `code`, `issuedAt`, `revealMs`, `redeemed`, `redeemedAt`. |
| `getLeaderboard` | `(limit?: number) → LeaderboardEntry[]` | Top-N fastest cracks, sorted by `revealMs` ascending. Excludes entries with no timing data. Each entry: `rank`, `code`, `revealMs`, `redeemed`. |
| `resetLedger` | `() → void` | Test hook — clears all state. |

---

### `backend/src/server/httpServer.js` — updated

Three admin routes added. Also updated `finish()` to pass `{ revealMs }` to
`generatePrizeCode` so crack times are recorded in the ledger for the leaderboard.

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/ledger` | Returns `{ codes: Entry[] }` — full ledger for the admin dashboard. |
| `GET` | `/admin/leaderboard` | Returns `{ leaderboard: LeaderboardEntry[] }` — top 10 fastest cracks. |
| `POST` | `/admin/redeem` | Body: `{ code: string }`. Returns `200 { ok: true }` on success, `409 already_redeemed`, `404 unknown_code`, or `400` for bad input. |

---

### `frontend/admin.html`

Prize-table staff dashboard. Served as a static file at `/admin.html`.

**Features:**
- **Redemption form** — staff type or scan a `VB-XXXXXXXX` code and click Redeem.
  Clear success/warning/error feedback:
  - `✓` green — redeemed, hand over prize
  - `⚠` amber — already redeemed, do **not** issue a second prize
  - `✗` red — code not found or invalid input
- **Fastest Cracks leaderboard** — top 10 by crack time, with redeemed status.
- **All Issued Codes table** — full list with crack time and redeemed status.
- Auto-refreshes every 5 seconds. Matches the terminal green-on-black kiosk aesthetic.

Navigate to: `http://<server-ip>:3000/admin.html`

---

### `backend/test/prizeLedger.test.js` — new (23 tests)

Unit tests for `prizeLedger.js`:
- Code format, alphabet, uniqueness
- `revealMs` recorded when meta provided / null when omitted
- `redeemCode` happy path, double-redemption, unknown code, non-string input
- `getLedger` ordering (newest first), redeemed status reflection, empty state
- `getLeaderboard` sort order, rank assignment, null-revealMs exclusion, limit param, redeemed flag, entry shape

### `backend/test/admin.test.js` — new (12 tests)

Integration tests for the admin HTTP endpoints (full server + WS session lifecycle):
- `GET /admin/ledger` — empty initially; populated after a completed WS session; `revealMs` recorded
- `GET /admin/leaderboard` — empty initially; entry appears after session completes
- `POST /admin/redeem` — success, double-redemption (409), unknown code (404), missing/empty code (400), non-JSON body (400)
- Redemption reflected in both ledger and leaderboard responses

---

## Test count

| Suite | Before | After |
|---|---|---|
| All suites | 46 | **82** |
| New tests added | — | +36 |
