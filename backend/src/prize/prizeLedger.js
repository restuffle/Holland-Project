'use strict';

const crypto = require('node:crypto');

const PREFIX = 'VB-';
const CODE_LENGTH = 8;
// Unambiguous uppercase alphanumerics: no 0/O, 1/I/L — easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Module-level ledger. In-memory only — no persistence across restarts.
const _ledger = new Map(); // code -> entry

// Leaderboard epoch: resetting between groups hides earlier entries from the
// leaderboard WITHOUT touching the ledger, so already-issued prize codes stay
// redeemable at the prize desk.
let _leaderboardResetAt = 0;

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return PREFIX + code;
}

/**
 * Generate a unique prize code and record it in the ledger.
 * @param {{ revealMs?: number, score?: number, name?: string }} [meta]
 * @returns {string}
 */
function generatePrizeCode(meta = {}) {
  // 31^8 ≈ 8.5e11 possibilities — collisions vanishingly rare but retry loop
  // makes in-process uniqueness a hard guarantee.
  let code = randomCode();
  while (_ledger.has(code)) {
    code = randomCode();
  }
  _ledger.set(code, {
    code,
    issuedAt: Date.now(),
    revealMs: meta.revealMs != null ? meta.revealMs : null,
    score: meta.score != null ? meta.score : null,
    name: typeof meta.name === 'string' && meta.name.length > 0 ? meta.name : null,
    redeemed: false,
    redeemedAt: null,
  });
  return code;
}

/**
 * Mark a code as redeemed. Idempotent reads the current state first so
 * double-scans by prize-table staff don't silently succeed twice.
 * @param {string} code
 * @returns {{ ok: true } | { ok: false, error: 'unknown_code' | 'already_redeemed' }}
 */
function redeemCode(code) {
  if (typeof code !== 'string') return { ok: false, error: 'unknown_code' };
  const entry = _ledger.get(code);
  if (!entry) return { ok: false, error: 'unknown_code' };
  if (entry.redeemed) return { ok: false, error: 'already_redeemed' };
  entry.redeemed = true;
  entry.redeemedAt = Date.now();
  return { ok: true };
}

/**
 * All issued codes, newest-first, for the admin dashboard.
 * @returns {Array<{ code: string, issuedAt: number, revealMs: number|null, score: number|null, name: string|null, redeemed: boolean, redeemedAt: number|null }>}
 */
function getLedger() {
  return Array.from(_ledger.values()).sort((a, b) => b.issuedAt - a.issuedAt);
}

/**
 * Top-N toughest passwords for the leaderboard, ranked by strength score
 * descending (highest score = hardest to crack = the one worth bragging
 * about — "fastest crack" would rank the weakest password first, which is
 * backwards for a security lesson). Ties broken by revealMs descending
 * (slower crack wins the tie). Excludes entries with no score (codes issued
 * without scoring data, e.g. via test hooks). Score itself isn't part of the
 * returned shape — rank already encodes it, and the display favors the
 * student's name over the raw number or the redemption code.
 * @param {number} [limit=10]
 * @returns {Array<{ rank: number, name: string|null, revealMs: number|null, redeemed: boolean }>}
 */
function getLeaderboard(limit = 10) {
  return Array.from(_ledger.values())
    .filter((e) => e.score != null && e.issuedAt > _leaderboardResetAt)
    .sort((a, b) => b.score - a.score || (b.revealMs || 0) - (a.revealMs || 0))
    .slice(0, limit)
    .map((e, i) => ({
      rank: i + 1,
      name: e.name,
      revealMs: e.revealMs,
      redeemed: e.redeemed,
    }));
}

/**
 * Hide all current entries from the leaderboard (start a fresh group).
 * Prize codes already issued remain valid and redeemable.
 */
function resetLeaderboard() {
  _leaderboardResetAt = Date.now();
}

/** Test hook: clear all issued codes and redemption state. */
function resetLedger() {
  _ledger.clear();
  _leaderboardResetAt = 0;
}

module.exports = {
  generatePrizeCode,
  redeemCode,
  getLedger,
  getLeaderboard,
  resetLeaderboard,
  resetLedger,
  PREFIX,
  CODE_LENGTH,
  ALPHABET,
};
