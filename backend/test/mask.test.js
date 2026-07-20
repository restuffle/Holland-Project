'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMask, generateFromMask, CLASS_CHARSETS, DEFAULT_MASK } = require('../src/engine/mask');

test('buildMask: classifies lower/upper/digit/symbol per position', () => {
  assert.equal(buildMask('ab12!@'), 'LLDDSS');
  assert.equal(buildMask('AB'), 'UU');
});

test('buildMask: truncates to 6 chars', () => {
  assert.equal(buildMask('abcdefgh'), 'LLLLLL');
});

test('buildMask: empty/non-string password falls back to the default mask', () => {
  assert.equal(buildMask(''), DEFAULT_MASK);
  assert.equal(buildMask(undefined), DEFAULT_MASK);
  assert.equal(buildMask(null), DEFAULT_MASK);
});

test('buildMask: guards against the template equaling the password itself', () => {
  assert.notEqual(buildMask('UUUUUU'), 'UUUUUU');
});

test('generateFromMask: every generated char belongs to its template class', () => {
  const mask = 'LUDS';
  for (let i = 0; i < 50; i += 1) {
    const text = generateFromMask(mask, Math.random);
    assert.ok(CLASS_CHARSETS.L.includes(text[0]));
    assert.ok(CLASS_CHARSETS.U.includes(text[1]));
    assert.ok(CLASS_CHARSETS.D.includes(text[2]));
    assert.ok(CLASS_CHARSETS.S.includes(text[3]));
  }
});

test('generateFromMask: falls back to the default mask for missing/empty input', () => {
  assert.equal(generateFromMask(undefined, Math.random).length, DEFAULT_MASK.length);
  assert.equal(generateFromMask('', Math.random).length, DEFAULT_MASK.length);
});
