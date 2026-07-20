'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');

const {
  generatePrizeCode,
  redeemCode,
  getLedger,
  getLeaderboard,
  resetLedger,
  PREFIX,
  CODE_LENGTH,
  ALPHABET,
} = require('../src/prize/prizeLedger');

beforeEach(() => resetLedger());

// --- generatePrizeCode ---

test('returns correct VB- format', () => {
  for (let i = 0; i < 200; i += 1) {
    assert.match(generatePrizeCode(), /^VB-[A-Z0-9]{8}$/);
  }
});

test('only uses unambiguous alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const body = generatePrizeCode().slice(PREFIX.length);
    for (const ch of body) {
      assert.ok(ALPHABET.includes(ch), `unexpected char: ${ch}`);
    }
  }
});

test('length equals PREFIX + CODE_LENGTH', () => {
  assert.strictEqual(generatePrizeCode().length, PREFIX.length + CODE_LENGTH);
});

test('never repeats within a process run', () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i += 1) {
    const code = generatePrizeCode();
    assert.ok(!seen.has(code), `duplicate: ${code}`);
    seen.add(code);
  }
});

test('records revealMs when provided via meta', () => {
  const code = generatePrizeCode({ revealMs: 12345 });
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.revealMs, 12345);
});

test('records null revealMs when meta omitted', () => {
  const code = generatePrizeCode();
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.revealMs, null);
});

test('records null revealMs when meta is empty object', () => {
  const code = generatePrizeCode({});
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.revealMs, null);
});

test('records score when provided via meta', () => {
  const code = generatePrizeCode({ score: 87.5 });
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.score, 87.5);
});

test('records null score when meta omitted', () => {
  const code = generatePrizeCode();
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.score, null);
});

// --- redeemCode ---

test('redeemCode returns ok:true for a valid unused code', () => {
  const code = generatePrizeCode();
  assert.deepStrictEqual(redeemCode(code), { ok: true });
});

test('redeemCode marks the entry as redeemed in the ledger', () => {
  const code = generatePrizeCode();
  redeemCode(code);
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.redeemed, true);
  assert.ok(entry.redeemedAt != null);
});

test('redeemCode returns already_redeemed on a second call', () => {
  const code = generatePrizeCode();
  redeemCode(code);
  assert.deepStrictEqual(redeemCode(code), { ok: false, error: 'already_redeemed' });
});

test('redeemCode returns unknown_code for unissued code', () => {
  assert.deepStrictEqual(redeemCode('VB-XXXXXXXX'), { ok: false, error: 'unknown_code' });
});

test('redeemCode returns unknown_code for non-string input', () => {
  assert.deepStrictEqual(redeemCode(null), { ok: false, error: 'unknown_code' });
  assert.deepStrictEqual(redeemCode(42), { ok: false, error: 'unknown_code' });
});

// --- getLedger ---

test('getLedger returns all issued codes', () => {
  const codes = [generatePrizeCode(), generatePrizeCode(), generatePrizeCode()];
  const ledger = getLedger();
  assert.strictEqual(ledger.length, 3);
  for (const code of codes) {
    assert.ok(ledger.some((e) => e.code === code));
  }
});

test('getLedger returns newest first', async () => {
  const a = generatePrizeCode();
  await new Promise((r) => setImmediate(r));
  const b = generatePrizeCode();
  const ledger = getLedger();
  assert.strictEqual(ledger[0].code, b);
  assert.strictEqual(ledger[1].code, a);
});

test('getLedger reflects redeemed status', () => {
  const code = generatePrizeCode();
  redeemCode(code);
  const entry = getLedger().find((e) => e.code === code);
  assert.strictEqual(entry.redeemed, true);
});

test('getLedger returns empty array when no codes issued', () => {
  assert.deepStrictEqual(getLedger(), []);
});

// --- getLeaderboard ---
// Ranked by strength score descending (toughest password first) — "fastest
// crack" would rank the weakest password first, which is backwards for a
// security lesson.

test('getLeaderboard returns entries sorted by score descending', () => {
  generatePrizeCode({ score: 30, revealMs: 1 });
  generatePrizeCode({ score: 90, revealMs: 2 });
  generatePrizeCode({ score: 60, revealMs: 3 });
  const board = getLeaderboard();
  assert.strictEqual(board[0].score, 90);
  assert.strictEqual(board[1].score, 60);
  assert.strictEqual(board[2].score, 30);
});

test('getLeaderboard breaks score ties by revealMs descending (slower crack wins the tie)', () => {
  generatePrizeCode({ score: 50, revealMs: 10000 });
  generatePrizeCode({ score: 50, revealMs: 40000 });
  const board = getLeaderboard();
  assert.strictEqual(board[0].revealMs, 40000);
  assert.strictEqual(board[1].revealMs, 10000);
});

test('getLeaderboard assigns rank starting at 1', () => {
  generatePrizeCode({ score: 40 });
  generatePrizeCode({ score: 70 });
  const board = getLeaderboard();
  assert.strictEqual(board[0].rank, 1);
  assert.strictEqual(board[1].rank, 2);
});

test('getLeaderboard excludes entries with null score', () => {
  generatePrizeCode();
  generatePrizeCode({ score: 55 });
  const board = getLeaderboard();
  assert.strictEqual(board.length, 1);
  assert.strictEqual(board[0].score, 55);
});

test('getLeaderboard respects limit param', () => {
  for (let i = 1; i <= 15; i += 1) generatePrizeCode({ score: i });
  assert.strictEqual(getLeaderboard(5).length, 5);
  assert.strictEqual(getLeaderboard(10).length, 10);
});

test('getLeaderboard returns empty array with no scored entries', () => {
  generatePrizeCode();
  assert.deepStrictEqual(getLeaderboard(), []);
});

test('getLeaderboard reflects redeemed flag', () => {
  const code = generatePrizeCode({ score: 65 });
  redeemCode(code);
  assert.strictEqual(getLeaderboard()[0].redeemed, true);
});

test('getLeaderboard entry has expected shape', () => {
  const code = generatePrizeCode({ score: 72, revealMs: 7500 });
  const entry = getLeaderboard()[0];
  assert.deepStrictEqual(Object.keys(entry).sort(), ['code', 'rank', 'redeemed', 'revealMs', 'score']);
  assert.strictEqual(entry.code, code);
});
