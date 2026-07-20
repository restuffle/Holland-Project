const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCrackPlan } = require('../src/engine/crackPlan');
const { MIN_CRACK_MS, HARD_CAP_MS } = require('../src/engine/timing');

const zeroJitter = () => 0.5;

test('dictionary-hit password produces single dictionary stage and low crack time', () => {
  const plan = buildCrackPlan('123456', zeroJitter);
  assert.deepEqual(plan.stages, ['dictionary']);
  assert.ok(
    plan.targetCrackTimeMs >= MIN_CRACK_MS && plan.targetCrackTimeMs <= MIN_CRACK_MS + 5000,
    `expected targetCrackTimeMs close to MIN_CRACK_MS, got ${plan.targetCrackTimeMs}`
  );
});

test('strong non-dictionary password produces full stage list and valid crack time range', () => {
  const plan = buildCrackPlan('Zz9!Qw', zeroJitter);
  assert.deepEqual(plan.stages, ['dictionary', 'mask', 'bruteforce']);
  assert.ok(plan.targetCrackTimeMs >= MIN_CRACK_MS);
  assert.ok(plan.targetCrackTimeMs <= HARD_CAP_MS);
});

test('returned plan never contains the raw password value', () => {
  const password = 'Zz9!Qw';
  const plan = buildCrackPlan(password, zeroJitter);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'password'), false);
  assert.ok(!JSON.stringify(plan).includes(password));
});

test('attemptPool excludes the real password even on a dictionary hit', () => {
  // '123456' is itself a commonPasswords entry, so this is the exact case where
  // an unfiltered sample would be very likely to include the real password.
  const password = '123456';
  const plan = buildCrackPlan(password, zeroJitter);
  assert.ok(Array.isArray(plan.attemptPool) && plan.attemptPool.length > 0);
  assert.ok(!plan.attemptPool.includes(password));
});

test('attemptPool is non-empty for a non-dictionary password too', () => {
  const plan = buildCrackPlan('Zz9!Qw', zeroJitter);
  assert.ok(Array.isArray(plan.attemptPool) && plan.attemptPool.length > 0);
});

test('plan.mask is a structural class template derived from the password shape', () => {
  assert.equal(buildCrackPlan('Wolf42', zeroJitter).mask, 'ULLLDD');
  assert.equal(buildCrackPlan('42wolf', zeroJitter).mask, 'DDLLLL');
  assert.equal(buildCrackPlan('Wolf!!', zeroJitter).mask, 'ULLLSS');
});

test('plan.mask never equals the raw password, even for the pathological self-referential case', () => {
  // Every char in "UUUUUU" classifies to the class letter 'U' itself, so an
  // unguarded template would equal the password verbatim.
  const plan = buildCrackPlan('UUUUUU', zeroJitter);
  assert.notEqual(plan.mask, 'UUUUUU');
});
