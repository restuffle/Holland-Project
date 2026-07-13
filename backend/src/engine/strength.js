const commonPasswords = require('./commonPasswords');

const POOL = { lower: 26, upper: 26, digit: 10, symbol: 32 };
const MAX_LEN = 6;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function detectPools(password) {
  const pools = new Set();
  const str = typeof password === 'string' ? password : '';
  for (const ch of str) {
    if (/[a-z]/.test(ch)) {
      pools.add('lower');
    } else if (/[A-Z]/.test(ch)) {
      pools.add('upper');
    } else if (/[0-9]/.test(ch)) {
      pools.add('digit');
    } else {
      pools.add('symbol');
    }
  }
  return pools;
}

function poolSize(poolsSet) {
  let total = 0;
  for (const name of poolsSet) {
    total += POOL[name] || 0;
  }
  return total > 0 ? total : 1;
}

// Approximate: real-world charset overlap and human non-uniform character
// choice mean this is an estimate, not a cryptographic guarantee.
const MAX_ENTROPY_BITS = MAX_LEN * Math.log2(POOL.lower + POOL.upper + POOL.digit + POOL.symbol);

function calculateEntropyBits(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return 0;
  }
  // Truncate defensively before pool detection: both the length term and the
  // pool-composition term must be derived from the same capped window, otherwise
  // characters beyond MAX_LEN can still inflate the score via new character classes,
  // and arbitrarily long input would otherwise be scanned in full.
  const truncated = password.slice(0, MAX_LEN);
  const pools = detectPools(truncated);
  const size = poolSize(pools);
  return truncated.length * Math.log2(size);
}

function isCommonPassword(password) {
  if (typeof password !== 'string') {
    return false;
  }
  return commonPasswords.has(password.slice(0, MAX_LEN).toLowerCase());
}

function computeStrengthScore(password) {
  if (typeof password !== 'string' || password.length === 0) {
    return { score: 0, entropyBits: 0, dictionaryHit: false };
  }

  const dictionaryHit = isCommonPassword(password);
  const entropyBits = calculateEntropyBits(password);
  let score = clamp((entropyBits / MAX_ENTROPY_BITS) * 100, 0, 100);

  if (dictionaryHit) {
    score = Math.min(score, 5);
  }

  return { score, entropyBits, dictionaryHit };
}

module.exports = {
  calculateEntropyBits,
  isCommonPassword,
  computeStrengthScore,
  MAX_ENTROPY_BITS,
  detectPools,
  poolSize,
};
