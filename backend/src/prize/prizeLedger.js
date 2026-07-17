'use strict';

const crypto = require('node:crypto');

const PREFIX = 'VB-';
const CODE_LENGTH = 8;
// Unambiguous uppercase alphanumerics: no 0/O, 1/I/L — easy to read aloud and type.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Module-level ledger. In-memory only — no persistence across restarts.
const _ledger = new Map(); // code -> entry

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return PREFIX + code;
}

/**
 * Generate a unique prize code and record it in the ledger.
 * @param {{ revealMs?: number }} [meta]
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
 * @returns {Array<{ code: string, issuedAt: number, revealMs: number|null, redeemed: boolean, redeemedAt: number|null }>}
 */
function getLedger() {
  return Array.from(_ledger.values()).sort((a, b) => b.issuedAt - a.issuedAt);
}

/**
 * Top-N fastest cracks for the leaderboard. Excludes entries with no revealMs
 * (codes issued without timing data, e.g. via test hooks).
 * @param {number} [limit=10]
 * @returns {Array<{ rank: number, code: string, revealMs: number, redeemed: boolean }>}
 */
function getLeaderboard(limit = 10) {
  return Array.from(_ledger.values())
    .filter((e) => e.revealMs != null)
    .sort((a, b) => a.revealMs - b.revealMs)
    .slice(0, limit)
    .map((e, i) => ({
      rank: i + 1,
      code: e.code,
      revealMs: e.revealMs,
      redeemed: e.redeemed,
    }));
}

/** Test hook: clear all issued codes and redemption state. */
function resetLedger() {
  _ledger.clear();
}

module.exports = {
  generatePrizeCode,
  redeemCode,
  getLedger,
  getLeaderboard,
  resetLedger,
  PREFIX,
  CODE_LENGTH,
  ALPHABET,
};
