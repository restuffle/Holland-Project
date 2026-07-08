# Operation: Vault Breach — Build Plan

## Concept
High schoolers walk up to a kiosk, type a password (≤6 chars, any charset they want), hit "Breach". A live terminal-style cracker chews through it on screen — dictionary hits, pattern guesses, then raw brute force — and lands on the password within a calibrated 8–55 second window. When it cracks, confetti/alarm-lights fire, a unique prize code drops, they redeem it at the prize table. Screen also shows "real world" crack-time math for their password so there's an actual security lesson baked in, not just a light show.

**Design call (flagging this explicitly since the brief left it implicit):** "win" = the crack *succeeds* before the clock runs out — every run is a guaranteed win. This satisfies "solvable" (100% crack rate, since the whole pedagogical point is "no ≤6-char password is safe"), "not too easy" (target time is calibrated per password, never instant), and "let them win" (guaranteed payoff for prize-giving) all at once. If the intended framing was "win = survive uncracked," flip the win condition — the architecture below still works either way.

## Why true brute force alone doesn't work here
Full keyspace on 6 chars with symbols is billions of combinations — a real from-scratch brute force wouldn't reliably land inside 60 seconds on a laptop, and would be *instant* for weak passwords, wrecking the "everyone gets ~1 minute" requirement. So the engine is a **hybrid**, same order real crackers use:

1. **Dictionary/rule pass** — top common passwords + leetspeak + keyboard walks (`qwerty`, `123456`, `abc123`...). Weak picks die almost immediately — that's the lesson.
2. **Mask/pattern pass** — structural guesses (word+digit, digit+word, capitalized+symbol) based on what the input looks like.
3. **Brute-force fallback** — iterate the actual charset space in order, animated.

Since the server already knows the password the instant it's typed in, it can compute a **target reveal time** from a strength score (weak → ~8s, strong → ~50s, hard cap 55s) and pace the visible "attempts/sec" counter to land the real hit at that moment — genuinely running the real dictionary/mask logic (so weak passwords *actually* die in the dictionary pass, that part's not faked), just governing the brute-force fallback's visible speed so timing stays in the 60s window. Add a couple of red-herring "near-miss" flashes for tension without touching the real completion time.

## Team (1 security + 4 web dev)

| Role | Owner | Owns |
|---|---|---|
| Cracking engine + strength scoring | **Security lead** | Dictionary/mask/brute-force logic, entropy scoring formula, timing calibration, the "what would really happen" lesson content, playtesting for exploits (empty password, script-spam, XSS in the password field itself) |
| Frontend / game UI | Dev 1 | Terminal ticker animation, timer, win screen, "Access Granted" sequence, sound/visual theming |
| Backend / realtime API | Dev 2 | Session endpoint, WebSocket (Socket.io) or SSE stream for live attempt feed, integrates the engine as a service |
| Leaderboard + prize ledger | Dev 3 | Unique redeemable code per win, anti-duplicate-redemption store, admin dashboard for prize-table staff, "fastest crack" leaderboard on a shared screen |
| Kiosk ops + deployment | Dev 4 | Multi-station local deployment (no internet dependency — run on venue LAN), QR check-in per student, cross-browser/device testing, on-site troubleshooting kit |

## Architecture
- **Frontend:** React or plain HTML/CSS/JS + a bit of GSAP/canvas for the ticker and vault-cracking animation.
- **Backend:** Node/Express, in-memory or SQLite session store (event is short-lived, no need for heavy infra).
- **Transport:** WebSocket for the live attempt stream (feels more "hacker movie" than polling).
- **Storage/privacy:** passwords never persisted past the session — hash or drop immediately after the run ends. No plaintext logging. Sanitize password input before ever echoing it back into the DOM (XSS guard) even though it's the student's own input.
- **Hosting:** run locally on a laptop/mini-server on venue wifi — don't depend on external internet during the event.

## Engagement layer
- Theme: "Operation Vault Breach" — terminal green-on-black hacker aesthetic, scrolling attempt log, tension music, alarm klaxon + strobe on success.
- End screen shows two things side by side: the gamified result AND the real math — "A real attacker at 10B guesses/sec cracks this in X" — so it's a legit teaching moment, not just fireworks.
- Prize code shown as both text + QR for fast redemption at the table.
- Optional shared "leaderboard" screen at the venue showing fastest cracks — extra bragging-rights prize.

## Guardrails
- Minimum 3–5s of animation even for trivially weak input, so it never feels broken/instant.
- Rate-limit submissions per station to prevent spam.
- Content-filter the password field display (don't publicly show offensive strings on the shared leaderboard).
- No real password reuse risk — this is a live demo string, not tied to any account, make that explicit on-screen ("don't use a real password of yours!").

## Build timeline (assuming a few prep days before the event)
1. **Day 1:** Scaffold repo (frontend/backend split), lock the API contract between engine and UI, security lead builds the scoring/timing formula in isolation with unit tests.
2. **Day 2:** Dev 2 wires engine into the WebSocket service; Dev 1 builds the ticker/timer UI against mock data; Dev 3 builds the prize-code ledger.
3. **Day 3:** Full integration; security lead playtests for exploits and timing edge cases (empty string, all-same-char, max-length symbol soup); Dev 4 starts kiosk deployment scripts.
4. **Day 4:** On-site rehearsal on real kiosk hardware/network, load-test with multiple simultaneous stations, polish sound/animation timing.

## Stretch goals (if time allows)
- Difficulty-select mode for repeat players.
- "Bonus round" — crack a password with a hint (one character revealed) for a harder prize tier.
- Post-event stats screen: most common weak patterns seen that day (aggregate, anonymized) — good closer for a security talk.
