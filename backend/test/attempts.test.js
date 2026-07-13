const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeStageDurations,
  generateAttemptText,
  buildAttemptTimeline,
  BRUTEFORCE_CHARSET,
  BRUTEFORCE_LEN,
} = require('../src/engine/attempts');
const { buildCrackPlan } = require('../src/engine/crackPlan');

const zeroJitter = () => 0.5;

test('computeStageDurations: single-stage plan spans the full target time', () => {
  const boundaries = computeStageDurations({ stages: ['dictionary'], targetCrackTimeMs: 9000 });
  assert.deepEqual(boundaries, [{ stage: 'dictionary', startMs: 0, endMs: 9000 }]);
});

test('computeStageDurations: three-stage plan is contiguous and sums to the target time', () => {
  const targetCrackTimeMs = 40000;
  const boundaries = computeStageDurations({
    stages: ['dictionary', 'mask', 'bruteforce'],
    targetCrackTimeMs,
  });

  assert.equal(boundaries.length, 3);
  assert.equal(boundaries[0].startMs, 0);
  assert.equal(boundaries[0].stage, 'dictionary');
  assert.equal(boundaries[1].startMs, boundaries[0].endMs);
  assert.equal(boundaries[1].stage, 'mask');
  assert.equal(boundaries[2].startMs, boundaries[1].endMs);
  assert.equal(boundaries[2].stage, 'bruteforce');
  assert.equal(boundaries[2].endMs, targetCrackTimeMs);
  boundaries.forEach((b) => assert.ok(b.endMs > b.startMs, `stage ${b.stage} has non-positive duration`));
});

test('computeStageDurations: unusually small target time still scales lead stages down without going negative', () => {
  // 2000ms is below the 1500+1500=3000ms floor the two lead stages would
  // normally claim — this is the branch that rescales them proportionally.
  const targetCrackTimeMs = 2000;
  const boundaries = computeStageDurations({
    stages: ['dictionary', 'mask', 'bruteforce'],
    targetCrackTimeMs,
  });

  assert.equal(boundaries.length, 3);
  assert.equal(boundaries[2].endMs, targetCrackTimeMs);
  boundaries.forEach((b) => assert.ok(b.endMs > b.startMs, `stage ${b.stage} has non-positive duration`));
  assert.ok(boundaries[2].endMs - boundaries[2].startMs > 0, 'final stage keeps a positive share');
});

test('generateAttemptText: dictionary stage only ever returns a pool entry', () => {
  const pool = ['aaa111', 'bbb222', 'ccc333'];
  for (let i = 0; i < 20; i += 1) {
    const text = generateAttemptText('dictionary', pool, Math.random);
    assert.ok(pool.includes(text), `"${text}" was not drawn from the given pool`);
  }
});

test('generateAttemptText: mask stage returns a word+digits pattern', () => {
  const text = generateAttemptText('mask', [], zeroJitter);
  assert.match(text, /^[a-z]+\d{1,2}$/);
});

test('generateAttemptText: bruteforce stage returns a charset string of the expected length', () => {
  const text = generateAttemptText('bruteforce', [], zeroJitter);
  assert.equal(text.length, BRUTEFORCE_LEN);
  for (const ch of text) {
    assert.ok(BRUTEFORCE_CHARSET.includes(ch), `"${ch}" is outside BRUTEFORCE_CHARSET`);
  }
});

test('generateAttemptText: unknown stage throws RangeError', () => {
  assert.throws(() => generateAttemptText('not-a-real-stage', [], zeroJitter), RangeError);
});

test('buildAttemptTimeline: dictionary-hit plan never surfaces the real password', () => {
  const password = '123456';
  const plan = buildCrackPlan(password, zeroJitter);
  const timeline = buildAttemptTimeline(plan, { randomFn: Math.random });

  assert.ok(timeline.length > 0);
  timeline.forEach((entry) => {
    assert.equal(entry.stage, 'dictionary');
    assert.notEqual(entry.text, password);
    assert.ok(entry.elapsedMs >= 0 && entry.elapsedMs < plan.targetCrackTimeMs);
  });
});

test('buildAttemptTimeline: attemptsPerSecond controls how many entries are produced', () => {
  const plan = buildCrackPlan('Zz9!Qw', zeroJitter);
  const sparse = buildAttemptTimeline(plan, { attemptsPerSecond: 1 });
  const dense = buildAttemptTimeline(plan, { attemptsPerSecond: 20 });
  assert.ok(dense.length > sparse.length);
});
