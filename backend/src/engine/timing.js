const MIN_CRACK_MS = 8000;
const MAX_CRACK_MS = 50000;
const HARD_CAP_MS = 55000;
const JITTER_MS = 3000;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function calculateTargetCrackTimeMs(score, randomFn = Math.random) {
  if (typeof score !== 'number' || Number.isNaN(score)) {
    throw new TypeError('score must be a finite number');
  }

  const clampedScore = clamp(score, 0, 100);
  const base = MIN_CRACK_MS + (clampedScore / 100) * (MAX_CRACK_MS - MIN_CRACK_MS);
  const rawRandom = randomFn();
  // Guard against a misbehaving randomFn (NaN/Infinity/undefined): fall back to zero
  // jitter rather than letting a non-finite value propagate through the clamp below,
  // where Math.min/Math.max would otherwise pass NaN straight through.
  const jitter = (Number.isFinite(rawRandom) ? rawRandom * 2 - 1 : 0) * JITTER_MS;
  const result = Math.round(base + jitter);

  return clamp(result, MIN_CRACK_MS, HARD_CAP_MS);
}

module.exports = {
  calculateTargetCrackTimeMs,
  MIN_CRACK_MS,
  MAX_CRACK_MS,
  HARD_CAP_MS,
  JITTER_MS,
};
