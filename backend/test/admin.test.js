'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { createServer } = require('../src/server/httpServer');
const prizeCode = require('../src/prize/prizeCode');
const { FrameParser, OPCODES } = require('../src/server/wsFrames');

// Reset the ledger before each test so codes from other tests don't bleed in.
beforeEach(() => prizeCode.resetLedger());

const fakeEngine = {
  buildCrackPlan: () => ({
    score: 12,
    entropyBits: 9.5,
    dictionaryHit: true,
    targetCrackTimeMs: 100,
    stages: ['dictionary'],
    attemptPool: [],
  }),
  buildAttemptTimeline: () => [],
  computeStageDurations: (plan) => [{ stage: 'dictionary', startMs: 0, endMs: plan.targetCrackTimeMs }],
};

const ADMIN_TOKEN = 'test-admin-token';

function startServer() {
  const server = createServer({ engine: fakeEngine, adminToken: ADMIN_TOKEN });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function get(port, path, { adminToken = ADMIN_TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const headers = adminToken ? { 'x-admin-token': adminToken } : {};
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
    }).on('error', reject);
  });
}

function post(port, path, body, raw, { adminToken = ADMIN_TOKEN } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw !== undefined ? raw : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (adminToken) headers['x-admin-token'] = adminToken;
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out) }));
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

// Run a complete WS session and return all messages.
function wsRun(port, sessionId) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port,
      path: `/ws/sessions/${sessionId}`,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (_res, socket, head) => {
      const messages = [];
      let resolveClosed;
      const closed = new Promise((r) => { resolveClosed = r; });
      const parser = new FrameParser();
      const onFrames = (chunk) => {
        for (const f of parser.push(chunk)) {
          if (f.opcode === OPCODES.TEXT) messages.push(JSON.parse(f.payload.toString('utf8')));
          if (f.opcode === OPCODES.CLOSE) resolveClosed();
        }
      };
      socket.on('data', onFrames);
      if (head && head.length) onFrames(head);
      socket.on('close', () => resolveClosed());
      socket.on('error', () => {});
      closed.then(() => resolve(messages));
    });
    req.on('response', () => reject(new Error('upgrade rejected')));
    req.on('error', reject);
    req.end();
  });
}

// --- Admin auth gate ---

test('GET /admin/ledger without a token is rejected with 401', async () => {
  const { server, port } = await startServer();
  try {
    const res = await get(port, '/admin/ledger', { adminToken: null });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('GET /admin/leaderboard with the wrong token is rejected with 401', async () => {
  const { server, port } = await startServer();
  try {
    const res = await get(port, '/admin/leaderboard', { adminToken: 'not-the-real-token' });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test('POST /admin/redeem without a token is rejected with 401, even for a valid code', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    const messages = await wsRun(port, body.sessionId);
    const code = messages.find((m) => m.type === 'result').prizeCode;

    const res = await post(port, '/admin/redeem', { code }, undefined, { adminToken: null });
    assert.strictEqual(res.status, 401);

    // Code must still be redeemable afterward — the rejected attempt didn't burn it.
    const legit = await post(port, '/admin/redeem', { code });
    assert.strictEqual(legit.status, 200);
  } finally {
    server.close();
  }
});

// --- GET /admin/ledger ---

test('GET /admin/ledger returns 200 with empty codes array initially', async () => {
  const { server, port } = await startServer();
  try {
    const res = await get(port, '/admin/ledger');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { codes: [] });
  } finally {
    server.close();
  }
});

test('GET /admin/ledger lists codes issued via completed WS sessions', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    await wsRun(port, body.sessionId);

    const res = await get(port, '/admin/ledger');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.codes.length, 1);
    assert.match(res.body.codes[0].code, /^VB-[A-Z0-9]{8}$/);
    assert.ok(res.body.codes[0].issuedAt > 0);
    assert.strictEqual(typeof res.body.codes[0].redeemed, 'boolean');
  } finally {
    server.close();
  }
});

test('GET /admin/ledger records revealMs from the completed session', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    await wsRun(port, body.sessionId);

    const res = await get(port, '/admin/ledger');
    assert.ok(res.body.codes[0].revealMs >= 100);
  } finally {
    server.close();
  }
});

// --- GET /admin/leaderboard ---

test('GET /admin/leaderboard returns 200 with empty leaderboard initially', async () => {
  const { server, port } = await startServer();
  try {
    const res = await get(port, '/admin/leaderboard');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { leaderboard: [] });
  } finally {
    server.close();
  }
});

test('GET /admin/leaderboard shows entry after a completed session', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    await wsRun(port, body.sessionId);

    const res = await get(port, '/admin/leaderboard');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.leaderboard.length, 1);
    assert.strictEqual(res.body.leaderboard[0].rank, 1);
    assert.ok(res.body.leaderboard[0].revealMs >= 100);
    assert.match(res.body.leaderboard[0].code, /^VB-[A-Z0-9]{8}$/);
  } finally {
    server.close();
  }
});

// --- POST /admin/redeem ---

test('POST /admin/redeem returns 200 ok:true for a valid code', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    const messages = await wsRun(port, body.sessionId);
    const code = messages.find((m) => m.type === 'result').prizeCode;

    const res = await post(port, '/admin/redeem', { code });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { ok: true });
  } finally {
    server.close();
  }
});

test('POST /admin/redeem returns 409 already_redeemed on second redemption', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    const messages = await wsRun(port, body.sessionId);
    const code = messages.find((m) => m.type === 'result').prizeCode;

    await post(port, '/admin/redeem', { code });
    const second = await post(port, '/admin/redeem', { code });
    assert.strictEqual(second.status, 409);
    assert.strictEqual(second.body.error, 'already_redeemed');
  } finally {
    server.close();
  }
});

test('POST /admin/redeem returns 404 unknown_code for unissued code', async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, '/admin/redeem', { code: 'VB-XXXXXXXX' });
    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error, 'unknown_code');
  } finally {
    server.close();
  }
});

test('POST /admin/redeem returns 400 invalid_code when code field missing', async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, '/admin/redeem', {});
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_code');
  } finally {
    server.close();
  }
});

test('POST /admin/redeem returns 400 invalid_code when code is empty string', async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, '/admin/redeem', { code: '' });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_code');
  } finally {
    server.close();
  }
});

test('POST /admin/redeem returns 400 invalid_request for non-JSON body', async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, '/admin/redeem', null, 'not json{');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'invalid_request');
  } finally {
    server.close();
  }
});

test('redemption reflected in subsequent ledger and leaderboard responses', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc' });
    const messages = await wsRun(port, body.sessionId);
    const code = messages.find((m) => m.type === 'result').prizeCode;

    await post(port, '/admin/redeem', { code });

    const ledger = await get(port, '/admin/ledger');
    const ledgerEntry = ledger.body.codes.find((e) => e.code === code);
    assert.strictEqual(ledgerEntry.redeemed, true);

    const board = await get(port, '/admin/leaderboard');
    const boardEntry = board.body.leaderboard.find((e) => e.code === code);
    assert.strictEqual(boardEntry.redeemed, true);
  } finally {
    server.close();
  }
});
