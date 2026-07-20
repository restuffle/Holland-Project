const commonPasswords = require('./commonPasswords');
const { computeStrengthScore } = require('./strength');
const { calculateTargetCrackTimeMs } = require('./timing');
const { buildMask } = require('./mask');

const ATTEMPT_POOL_SIZE = 8;

// Sampled here, while the real password is still in scope, so the ticker's
// dictionary-stage generator never needs the password at all downstream — it can
// only ever show entries from this pre-filtered pool, never the real one, even
// when dictionaryHit is true (the case where the password IS a list entry).
function buildAttemptPool(password, randomFn) {
  const excluded = typeof password === 'string' ? password.slice(0, 6).toLowerCase() : null;
  const candidates = Array.from(commonPasswords).filter((entry) => entry !== excluded);

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(randomFn() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, ATTEMPT_POOL_SIZE);
}

function buildCrackPlan(password, randomFn = Math.random) {
  const { score, entropyBits, dictionaryHit } = computeStrengthScore(password);
  const targetCrackTimeMs = calculateTargetCrackTimeMs(score, randomFn);
  const passwordLength = typeof password === 'string' ? password.length : 0;
  const stages = dictionaryHit ? ['dictionary'] : ['dictionary', 'mask', 'bruteforce'];
  const attemptPool = buildAttemptPool(password, randomFn);
  const mask = buildMask(password);

  return {
    passwordLength,
    score,
    entropyBits,
    dictionaryHit,
    targetCrackTimeMs,
    stages,
    attemptPool,
    mask,
  };
}

module.exports = { buildCrackPlan, ATTEMPT_POOL_SIZE };
