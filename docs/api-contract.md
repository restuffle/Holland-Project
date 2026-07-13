# Operation Vault Breach — API Contract (Day 1 lock)

This locks the interface between the scoring/timing engine (`backend/src/engine`) and
tomorrow's backend service (Dev 2) and frontend UI (Dev 1). Implementation details
(framework, WebSocket library, storage internals) are left to whoever builds each side —
this doc only fixes the shapes and behavior both sides can rely on.

## POST /api/sessions

Starts a new crack session for a password the student just typed.

**Request body**

```json
{ "password": "abc123" }
```

- `password` must be a string, length 1-6 (inclusive).

**Response `201 Created`**

```json
{
  "sessionId": "string, opaque unique id",
  "plan": {
    "score": 4.2,
    "entropyBits": 5.6,
    "dictionaryHit": true,
    "targetCrackTimeMs": 9100,
    "stages": ["dictionary"]
  }
}
```

- `sessionId` must be generated with a cryptographically secure random source (e.g.
  `crypto.randomUUID()`), with at least ~122 bits of entropy. It is the sole bearer
  credential for the WebSocket stream below (including the `result` event's
  `prizeCode`), so it must be unguessable and non-enumerable. It must also be URL-safe
  (matches `[A-Za-z0-9_-]+`) since it is interpolated directly into the WebSocket path
  below — no percent-encoding is required or expected.
- `plan` is computed immediately on this request by calling today's engine
  (`buildCrackPlan(password)` from `backend/src/engine`) — it is not recomputed later,
  and the WebSocket stream (below) paces itself against this precomputed `plan`.
- The raw `password` value is **never** included in this response, in the `plan` object,
  in any later response, or in any log line. It is used only synchronously, in-memory,
  to compute `plan`, and **must be discarded immediately after that call returns** — it
  is never written into the session record and is never read again for the lifetime of
  the session.

**Error responses**

- `400 Bad Request` — `password` is missing, not a string, empty (length 0), or longer
  than 6 characters. Body: `{ "error": "invalid_password" }`.
- `400 Bad Request` — the request body is missing, not valid JSON, or otherwise
  unparseable (independent of the password-specific check above). Body:
  `{ "error": "invalid_request" }`.

**Rate limiting & idempotency**

- The implementation must apply per-IP/per-station rate limiting to this endpoint (e.g.
  `express-rate-limit`) to bound in-memory session growth from spam or retries.
- No idempotency key or request de-duplication is required: each call creates a
  brand-new, independent session, `sessionId`, and guaranteed win. A double-submit
  (double-click, client-side retry) is expected to produce two independent sessions by
  design; the rate limit above bounds the worst case.

## WebSocket: /ws/sessions/:sessionId

Streams the simulated crack in progress for a session created above. One connection per
session; the server drives the pacing using the session's precomputed `plan`. A second,
concurrent connection attempt to a session that already has an active connection is
rejected — see "Error responses" below.

**Event types** (each message is a JSON object with a `type` field):

```json
{ "type": "attempt", "text": "trying 'qwerty12'...", "elapsedMs": 1340 }
```
```json
{ "type": "stage", "stage": "mask" }
```
```json
{ "type": "result", "success": true, "prizeCode": "VB-7F3K2Q", "revealMs": 41200 }
```

- `attempt` — a cosmetic ticker line for the terminal-style UI. `text` is display-only
  and must never contain the real password; `elapsedMs` is ms since the session's crack
  attempt began, where the crack clock starts at session creation (POST time),
  independent of when/whether a WebSocket connects — a client that connects late sees
  `elapsedMs` values that already reflect time elapsed since creation, not since
  connect. All server-supplied display strings (`attempt.text`, `stage.stage`, etc.)
  must be rendered on the frontend via `textContent` or otherwise HTML-escaped/
  sanitized — never via `innerHTML` with raw interpolation.
- `stage` — fired when the simulated cracker moves to a new stage. `stage` is one of
  `plan.stages` (`dictionary`, `mask`, `bruteforce`). Exactly one `stage` event is sent
  for each entry in `plan.stages`, in the same order, and all of them complete before the
  terminal `result` event.
- `result` — fired exactly once, when the crack completes. `success` is always `true`
  per the game design (every run is a guaranteed win). `revealMs` is the actual elapsed
  time at reveal, expected to land at/near `plan.targetCrackTimeMs`. `prizeCode` is
  generated fresh per session.
  **Blocking cross-team dependency:** `prizeCode` format/uniqueness/generation is owned
  by Dev 3's ledger, which does not exist yet as of this doc. Dev 2 cannot finish
  implementing the `result` event until Dev 3 publishes a callable interface (module
  path, function signature, sync vs. async, and error/timeout behavior). Until that
  interface exists, implement against this placeholder so integration isn't blocked: a
  synchronous `generatePrizeCode(): string` returning an 8-character uppercase
  alphanumeric string prefixed `VB-` (e.g. `VB-7F3K2Q`) — swap for the real ledger call
  once Dev 3 publishes it.
- After `result` is sent, the connection may be closed by the server; no further events
  are sent on that session.

## Session lifecycle

- Sessions live in an in-memory store only (no persistence across restarts).
- TTL: 5 minutes from creation. If no WebSocket connects within the TTL, the session is
  discarded and its `sessionId` becomes invalid. Once a WebSocket has connected, the
  session is exempt from TTL-based discard until `result` is sent — the engine
  guarantees `plan.targetCrackTimeMs` never exceeds `HARD_CAP_MS` (55s), well under the
  5-minute TTL, so a connected, in-progress session is never force-discarded mid-stream.
- If the client disconnects (socket closes) before `result` is sent, the session and its
  session record are discarded immediately — the server does not wait out the remaining
  TTL for a possible reconnect. A subsequent WebSocket connection attempt to that
  `sessionId` afterward receives `404 Not Found` (see below); the crack does not resume
  or restart on reconnect.
- The session record (already password-free, per `POST /api/sessions` above) is
  discarded immediately after the `result` event is sent on the WebSocket — nothing
  outlives that event.

## Error responses (WebSocket / session lookup)

Browser `WebSocket` clients cannot read an HTTP status code or body from a rejected
upgrade handshake — a failed handshake only surfaces to JS as a generic `error`/`close`
event. So the cases below are **not** raw HTTP responses to the upgrade request;
instead, the server accepts the upgrade, immediately sends one JSON error message, then
closes the socket with the indicated close code:

- `404 Not Found` — `sessionId` does not exist (expired, discarded, disconnected before
  `result`, or never created). Server sends
  `{ "type": "error", "code": 404, "error": "session_not_found" }`, then closes with WS
  close code `4404`. (There is no REST lookup endpoint for a session — the only way to
  read a session's state is via its WebSocket.)
- `409 Conflict` — the session has already completed (its `result` event was already
  sent) and cannot be replayed or reconnected to produce a second result. Server sends
  `{ "type": "error", "code": 409, "error": "session_completed" }`, then closes with WS
  close code `4409`.
- `409 Conflict` — a second, concurrent connection attempt to a session that already has
  an active connection. Server sends
  `{ "type": "error", "code": 409, "error": "session_in_use" }`, then closes with WS
  close code `4409`.
