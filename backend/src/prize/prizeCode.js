'use strict';

/**
 * Prize code generation — Day 2 placeholder for Dev 3's ledger.
 *
 * Interface per docs/api-contract.md ("Blocking cross-team dependency"):
 * a synchronous `generatePrizeCode(): string` returning an 8-character
 * uppercase alphanumeric string prefixed `VB-` (e.g. `VB-7F3K2Q`).
 *
 * Swap the internals for the real ledger call once Dev 3 publishes it —
 * the call sites only depend on the signature above.
 */

const crypto = require('node:crypto');

const PREFIX = 'VB-';
const CODE_LENGTH = 8;
// Unambiguous uppercase alphanumerics: no 0/O, 1/I/L to keep codes easy to
// read aloud and type at the prize table.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// In-process uniqueness guard. The real ledger owns global uniqueness; this
// just guarantees no duplicate codes within a single server run.
const issued = new Set();

function randomCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // randomInt is uniform and cryptographically secure.
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return PREFIX + code;
}

function generatePrizeCode() {
  // 31^8 ≈ 8.5e11 possibilities — collisions are vanishingly rare, but the
  // retry loop makes in-process uniqueness a hard guarantee anyway.
  let code = randomCode();
  while (issued.has(code)) {
    code = randomCode();
  }
  issued.add(code);
  return code;
}

/** Test hook: forget previously issued codes. */
function resetIssuedCodes() {
  issued.clear();
}

module.exports = {
  generatePrizeCode,
  resetIssuedCodes,
  PREFIX,
  CODE_LENGTH,
  ALPHABET,
};
