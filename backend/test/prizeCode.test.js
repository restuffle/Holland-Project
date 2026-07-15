'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const { generatePrizeCode, resetIssuedCodes, PREFIX, CODE_LENGTH, ALPHABET } = require('../src/prize/prizeCode');

beforeEach(() => resetIssuedCodes());

test('matches contract format: VB- prefix + 8 uppercase alphanumerics', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = generatePrizeCode();
    assert.match(code, /^VB-[A-Z0-9]{8}$/);
    assert.strictEqual(code.length, PREFIX.length + CODE_LENGTH);
  }
});

test('only uses unambiguous alphabet characters', () => {
  for (let i = 0; i < 200; i += 1) {
    const body = generatePrizeCode().slice(PREFIX.length);
    for (const ch of body) {
      assert.ok(ALPHABET.includes(ch), `unexpected character ${ch}`);
    }
  }
});

test('never repeats a code within a process run', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const code = generatePrizeCode();
    assert.ok(!seen.has(code), `duplicate code ${code}`);
    seen.add(code);
  }
});
