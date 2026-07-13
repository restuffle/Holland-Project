const test = require('node:test');
const assert = require('node:assert/strict');
const { computeStrengthScore, calculateEntropyBits } = require('../src/engine/strength');

test('empty string returns score 0, entropyBits 0, dictionaryHit false', () => {
  const result = computeStrengthScore('');
  assert.equal(result.score, 0);
  assert.equal(result.entropyBits, 0);
  assert.equal(result.dictionaryHit, false);
});

test('known dictionary entry is flagged as a dictionary hit and capped low', () => {
  const result = computeStrengthScore('123456');
  assert.equal(result.dictionaryHit, true);
  assert.ok(result.score <= 5, `expected score <= 5, got ${result.score}`);
});

test('high-entropy dictionary entry is still capped low despite near-max entropy', () => {
  const result = computeStrengthScore('P@SS12');
  assert.equal(result.dictionaryHit, true);
  assert.ok(result.score <= 5, `expected score <= 5, got ${result.score}`);
});

test('6-char password mixing all four pools scores meaningfully high', () => {
  const password = 'aB3#kZ';
  const result = computeStrengthScore(password);
  assert.equal(result.dictionaryHit, false);
  assert.ok(result.score > 60, `expected score > 60, got ${result.score}`);
});

test('entropy calculation caps at 6 characters regardless of input length', () => {
  const tenChar = 'abcdefghij';
  const sixChar = 'abcdef';
  assert.equal(calculateEntropyBits(tenChar), calculateEntropyBits(sixChar));
});

test('non-string input does not throw and returns score 0', () => {
  for (const input of [null, undefined, 12345]) {
    const result = computeStrengthScore(input);
    assert.equal(result.score, 0);
    assert.equal(result.entropyBits, 0);
    assert.equal(result.dictionaryHit, false);
  }
});
