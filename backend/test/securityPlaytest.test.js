'use strict';

/**
 * End-to-end regression tests for the exploit scenarios the Day 3 commit
 * message claimed were playtested (empty password already covered by
 * server.test.js's validation test): XSS-in-password-field, script-spam,
 * all-same-char, and max-length symbol-soup. Runs against the real engine
 * (not a fake), so it exercises actual strength/timing/mask behavior under
 * adversarial input, not just the transport layer.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createServer } = require('../src/server/httpServer');
const { createRateLimiter } = require('../src/server/rateLimit');
const realEngine = require('../src/engine');
const { MIN_CRACK_MS, HARD_CAP_MS } = require('../src/engine/timing');
const { FrameParser, OPCODES } = require('../src/server/wsFrames');

// Real engine logic (strength/mask/dictionary detection), but with
// targetCrackTimeMs clamped small — the server's WS pacing is driven off
// real wall-clock time, and the real engine can calibrate up to 55s, which
// would make these tests painfully slow. The timing-window itself is
// asserted separately below via a direct, un-clamped buildCrackPlan() call.
function fastEngine(overrideMs) {
  return {
    buildCrackPlan: (password) => ({ ...realEngine.buildCrackPlan(password), targetCrackTimeMs: overrideMs }),
    buildAttemptTimeline: realEngine.buildAttemptTimeline,
    computeStageDurations: realEngine.computeStageDurations,
  };
}

function startServer(opts = {}) {
  const server = createServer(opts);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(out), raw: out }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

// Runs a full WS session for a session id and returns every message plus the
// raw frame text, so tests can grep for password leakage in the wire bytes
// themselves, not just the parsed JSON.
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
      const rawChunks = [];
      let resolveClosed;
      const closed = new Promise((r) => { resolveClosed = r; });
      const parser = new FrameParser();
      const onFrames = (chunk) => {
        rawChunks.push(chunk);
        for (const f of parser.push(chunk)) {
          if (f.opcode === OPCODES.TEXT) messages.push(JSON.parse(f.payload.toString('utf8')));
          if (f.opcode === OPCODES.CLOSE) resolveClosed();
        }
      };
      socket.on('data', onFrames);
      if (head && head.length) onFrames(head);
      socket.on('close', () => resolveClosed());
      socket.on('error', () => {});
      closed.then(() => resolve({ messages, raw: Buffer.concat(rawChunks).toString('utf8') }));
    });
    req.on('response', () => reject(new Error('upgrade rejected')));
    req.on('error', reject);
    req.end();
  });
}

async function runFullSession(port, password, name = 'Sam') {
  const { body: created } = await post(port, '/api/sessions', { password, name });
  const { messages, raw } = await wsRun(port, created.sessionId);
  return { created, messages, raw };
}

// --- XSS-in-password-field ---

test('XSS-in-password-field: hostile password never appears in the HTTP response or any WS frame', async () => {
  const { server, port } = await startServer({ engine: fastEngine(150) });
  try {
    const password = '<img>'; // 5 chars — the field caps at 6, real script tags don't fit
    const { body: created, raw: createRaw } = await post(port, '/api/sessions', { password, name: 'Sam' });
    assert.strictEqual(created.plan.stages.includes('bruteforce'), true);
    assert.ok(!createRaw.includes(password));

    const { messages, raw } = await wsRun(port, created.sessionId);
    assert.ok(!raw.includes(password), 'raw WS bytes must never contain the raw password');
    messages.forEach((m) => assert.ok(!JSON.stringify(m).includes(password)));
    assert.strictEqual(messages.at(-1).type, 'result');
  } finally {
    server.close();
  }
});

test('XSS-in-password-field: angle-bracket password completes a normal session', async () => {
  const { server, port } = await startServer({ engine: fastEngine(150) });
  try {
    const { messages } = await runFullSession(port, '<a b>');
    const result = messages.find((m) => m.type === 'result');
    assert.strictEqual(result.success, true);
    assert.match(result.prizeCode, /^VB-[A-Za-z0-9]{8}$/);
  } finally {
    server.close();
  }
});

// --- XSS-in-name-field: the leaderboard's name column is new attacker-reachable
// surface, unlike password it's actually retained and displayed on admin.html.
// The contract's textContent-only rule already covers this (admin.html renders
// via setCell -> td.textContent), so this asserts the backend passes the
// hostile string through byte-for-byte rather than mangling or partially
// stripping it, leaving no doubt the display layer is the only sanitization point.

function getWithAdminToken(port, path, adminToken) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers: { 'x-admin-token': adminToken } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve(JSON.parse(out)));
    }).on('error', reject);
  });
}

test('XSS-in-name-field: hostile name is stored and surfaced verbatim in the leaderboard JSON (display layer, not the API, is responsible for escaping it)', async () => {
  const adminToken = 'test-admin-token';
  const { server, port } = await startServer({ engine: fastEngine(150), adminToken });
  try {
    const hostileName = '<script>alert(1)</script>';
    const { messages } = await runFullSession(port, 'Zz9!Qw', hostileName);
    const result = messages.find((m) => m.type === 'result');
    assert.strictEqual(result.success, true);

    const board = await getWithAdminToken(port, '/admin/leaderboard', adminToken);
    assert.strictEqual(board.leaderboard[0].name, hostileName);
  } finally {
    server.close();
  }
});

// --- script-spam (burst/flood, not just sequential) ---

test('script-spam: a concurrent burst of session-creation requests from one IP is rate limited', async () => {
  const limiter = createRateLimiter({ max: 5 });
  const { server, port } = await startServer({ rateLimiter: limiter });
  try {
    const burst = await Promise.all(
      Array.from({ length: 15 }, () => post(port, '/api/sessions', { password: 'abc', name: 'Sam' })),
    );
    const statuses = burst.map((r) => r.status);
    const ok = statuses.filter((s) => s === 201).length;
    const limited = statuses.filter((s) => s === 429).length;
    assert.strictEqual(ok, 5, `expected exactly 5 to succeed under the flood, got ${ok}`);
    assert.strictEqual(limited, 10, `expected the remaining 10 to be rate-limited, got ${limited}`);
  } finally {
    server.close();
  }
});

// --- all-same-char ---

test('all-same-char password ("aaaaaa"): real engine calibrates it within the timing window', () => {
  const plan = realEngine.buildCrackPlan('aaaaaa');
  assert.ok(plan.targetCrackTimeMs >= MIN_CRACK_MS && plan.targetCrackTimeMs <= HARD_CAP_MS);
});

test('all-same-char password ("aaaaaa") completes a full session and is never leaked', async () => {
  const { server, port } = await startServer({ engine: fastEngine(150) });
  try {
    const { messages } = await runFullSession(port, 'aaaaaa');
    const result = messages.find((m) => m.type === 'result');
    assert.strictEqual(result.success, true);
    assert.ok(!messages.some((m) => JSON.stringify(m).includes('aaaaaa')));
  } finally {
    server.close();
  }
});

// --- max-length symbol-soup ---

test('max-length symbol-soup password ("!@#$%^"): real engine calibrates it within the timing window', () => {
  const plan = realEngine.buildCrackPlan('!@#$%^');
  assert.ok(plan.targetCrackTimeMs >= MIN_CRACK_MS && plan.targetCrackTimeMs <= HARD_CAP_MS);
});

test('max-length symbol-soup password ("!@#$%^") completes a full session and is never leaked', async () => {
  const { server, port } = await startServer({ engine: fastEngine(150) });
  try {
    const password = '!@#$%^';
    const { messages, raw } = await runFullSession(port, password);
    const result = messages.find((m) => m.type === 'result');
    assert.strictEqual(result.success, true);
    assert.ok(!raw.includes(password));
  } finally {
    server.close();
  }
});
