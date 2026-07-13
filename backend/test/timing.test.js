const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateTargetCrackTimeMs,
  MIN_CRACK_MS,
  MAX_CRACK_MS,
  HARD_CAP_MS,
} = require('../src/engine/timing');

const zeroJitter = () => 0.5;

test('score 0 with zero jitter returns exactly MIN_CRACK_MS', () => {
  assert.equal(calculateTargetCrackTimeMs(0, zeroJitter), MIN_CRACK_MS);
});

test('score 100 with zero jitter returns exactly MAX_CRACK_MS', () => {
  assert.equal(calculateTargetCrackTimeMs(100, zeroJitter), MAX_CRACK_MS);
});

test('score 100 with an out-of-range randomFn is clamped down to HARD_CAP_MS', () => {
  // A randomFn returning a value outside Math.random's normal [0, 1) contract pushes
  // the pre-clamp result far above HARD_CAP_MS, so this actually exercises the upper
  // clamp bound (unlike randomFn returning 1, which never exceeds HARD_CAP_MS given
  // the current MIN_CRACK_MS/MAX_CRACK_MS/JITTER_MS constants).
  const result = calculateTargetCrackTimeMs(100, () => 1000);
  assert.equal(result, HARD_CAP_MS);
});

test('non-finite randomFn output falls back to zero jitter instead of NaN', () => {
  const result = calculateTargetCrackTimeMs(50, () => NaN);
  assert.ok(Number.isFinite(result), `expected a finite result, got ${result}`);
});

test('score 0 with max negative jitter never goes below MIN_CRACK_MS', () => {
  const result = calculateTargetCrackTimeMs(0, () => 0);
  assert.ok(result >= MIN_CRACK_MS, `expected >= MIN_CRACK_MS, got ${result}`);
});

test('NaN score throws TypeError', () => {
  assert.throws(() => calculateTargetCrackTimeMs(NaN), TypeError);
});

test('non-number score throws TypeError', () => {
  assert.throws(() => calculateTargetCrackTimeMs('80'), TypeError);
});

test('score above 100 is clamped rather than throwing', () => {
  const result = calculateTargetCrackTimeMs(150, zeroJitter);
  assert.equal(result, MAX_CRACK_MS);
});

test('score below 0 is clamped rather than throwing', () => {
  const result = calculateTargetCrackTimeMs(-50, zeroJitter);
  assert.equal(result, MIN_CRACK_MS);
});
