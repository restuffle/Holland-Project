'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { createServer } = require('../src/server/httpServer');
const { createRateLimiter } = require('../src/server/rateLimit');
const { encodeClose, FrameParser, OPCODES } = require('../src/server/wsFrames');

// Fast fake engine so integration tests complete in milliseconds while the
// real engine keeps its 8-55s event pacing.
const fakeEngine = {
  buildCrackPlan: () => ({
    score: 12,
    entropyBits: 9.5,
    dictionaryHit: true,
    targetCrackTimeMs: 250,
    stages: ['dictionary'],
    attemptPool: ['secret-pool-entry'],
  }),
  buildAttemptTimeline: () => [
    { stage: 'dictionary', elapsedMs: 40, text: "trying 'qwerty'..." },
    { stage: 'dictionary', elapsedMs: 120, text: "trying 'dragon'..." },
  ],
  computeStageDurations: (plan) => [{ stage: 'dictionary', startMs: 0, endMs: plan.targetCrackTimeMs }],
};

function startServer(opts = {}) {
  const server = createServer({ engine: fakeEngine, ...opts });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function post(port, path, body, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const data = raw ? body : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
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

/**
 * Minimal browser-like WebSocket client: performs the upgrade, collects JSON
 * messages, and records the server close code.
 */
function wsConnect(port, sessionId) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: `/ws/sessions/${sessionId}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const client = {
        socket,
        messages: [],
        closeCode: null,
        waitForClose() { return this.closed; },
        close() { socket.write(encodeClose(1000, '', { mask: true })); socket.end(); },
      };
      client.closed = new Promise((res2) => { client._resolveClosed = res2; });
      const parser = new FrameParser();
      const onFrames = (chunk) => {
        for (const frame of parser.push(chunk)) {
          if (frame.opcode === OPCODES.TEXT) client.messages.push(JSON.parse(frame.payload.toString('utf8')));
          if (frame.opcode === OPCODES.CLOSE && client.closeCode === null) client.closeCode = frame.closeCode ?? 1005;
        }
      };
      socket.on('data', onFrames);
      // Frames the server sent immediately after the 101 handshake arrive in
      // `head`, not as a later 'data' event.
      if (head && head.length) onFrames(head);
      socket.on('close', () => client._resolveClosed());
      socket.on('error', () => {});
      resolve(client);
    });
    req.on('response', () => reject(new Error('upgrade rejected')));
    req.on('error', reject);
    req.end();
  });
}

test('POST /api/sessions returns 201 with sessionId and public plan only', async () => {
  const { server, port } = await startServer();
  try {
    const res = await post(port, '/api/sessions', { password: 'abc123' });
    assert.strictEqual(res.status, 201);
    assert.match(res.body.sessionId, /^[A-Za-z0-9_-]+$/);
    assert.deepStrictEqual(Object.keys(res.body.plan).sort(), ['dictionaryHit', 'entropyBits', 'score', 'stages', 'targetCrackTimeMs']);
    // Never echo the password or leak pool internals.
    assert.ok(!JSON.stringify(res.body).includes('abc123'));
    assert.ok(!JSON.stringify(res.body).includes('secret-pool-entry'));
  } finally {
    server.close();
  }
});

test('POST /api/sessions validates password and body', async () => {
  const { server, port } = await startServer();
  try {
    for (const bad of [{}, { password: '' }, { password: '1234567' }, { password: 42 }]) {
      const res = await post(port, '/api/sessions', bad);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'invalid_password');
    }
    const notJson = await post(port, '/api/sessions', 'not json{', { raw: true });
    assert.strictEqual(notJson.status, 400);
    assert.strictEqual(notJson.body.error, 'invalid_request');
    const arrayBody = await post(port, '/api/sessions', ['x']);
    assert.strictEqual(arrayBody.status, 400);
    assert.strictEqual(arrayBody.body.error, 'invalid_request');
  } finally {
    server.close();
  }
});

test('POST /api/sessions is rate limited per IP', async () => {
  const limiter = createRateLimiter({ max: 3 });
  const { server, port } = await startServer({ rateLimiter: limiter });
  try {
    for (let i = 0; i < 3; i += 1) {
      const res = await post(port, '/api/sessions', { password: 'a' });
      assert.strictEqual(res.status, 201);
    }
    const blocked = await post(port, '/api/sessions', { password: 'a' });
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.body.error, 'rate_limited');
  } finally {
    server.close();
  }
});

test('WebSocket streams stage/attempt events then a single result, in order', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc123' });
    const client = await wsConnect(port, body.sessionId);
    await client.waitForClose();

    const types = client.messages.map((m) => m.type);
    assert.deepStrictEqual(types, ['stage', 'attempt', 'attempt', 'result']);
    assert.strictEqual(client.messages[0].stage, 'dictionary');

    const result = client.messages.at(-1);
    assert.strictEqual(result.success, true);
    assert.match(result.prizeCode, /^VB-[A-Z0-9]{8}$/);
    assert.ok(result.revealMs >= 250, `revealMs ${result.revealMs} should be >= target`);
    assert.strictEqual(client.closeCode, 1000);

    // attempt elapsedMs is monotonically non-decreasing
    const elapsed = client.messages.filter((m) => m.type === 'attempt').map((m) => m.elapsedMs);
    assert.deepStrictEqual(elapsed, [...elapsed].sort((a, b) => a - b));
  } finally {
    server.close();
  }
});

test('unknown session gets 404 error message and close code 4404', async () => {
  const { server, port } = await startServer();
  try {
    const client = await wsConnect(port, 'does-not-exist');
    await client.waitForClose();
    assert.deepStrictEqual(client.messages, [{ type: 'error', code: 404, error: 'session_not_found' }]);
    assert.strictEqual(client.closeCode, 4404);
  } finally {
    server.close();
  }
});

test('completed session gets 409 session_completed and close code 4409', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc123' });
    const first = await wsConnect(port, body.sessionId);
    await first.waitForClose();

    const replay = await wsConnect(port, body.sessionId);
    await replay.waitForClose();
    assert.deepStrictEqual(replay.messages, [{ type: 'error', code: 409, error: 'session_completed' }]);
    assert.strictEqual(replay.closeCode, 4409);
  } finally {
    server.close();
  }
});

test('second concurrent connection gets 409 session_in_use', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc123' });
    const first = await wsConnect(port, body.sessionId);
    const second = await wsConnect(port, body.sessionId);
    await second.waitForClose();
    assert.deepStrictEqual(second.messages, [{ type: 'error', code: 409, error: 'session_in_use' }]);
    assert.strictEqual(second.closeCode, 4409);
    await first.waitForClose(); // first stream still completes normally
    assert.strictEqual(first.messages.at(-1).type, 'result');
  } finally {
    server.close();
  }
});

test('oversized WS frame payload gets the socket destroyed, not buffered', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc123' });
    const client = await wsConnect(port, body.sessionId);

    // Declare a payload far beyond MAX_FRAME_PAYLOAD and never send the body
    // — a real attacker only needs the 10-byte header to try to force
    // unbounded buffering. The fix must reject this from the header alone.
    const header = Buffer.alloc(10);
    header[0] = 0x82; // FIN + binary opcode
    header[1] = 127; // 64-bit extended length follows
    header.writeBigUInt64BE(BigInt(50 * 1024 * 1024), 2); // 50MB, way over the cap
    client.socket.write(header);

    await client.waitForClose();
    // A rejected frame is a hard socket.destroy() — no WS close frame, so
    // closeCode is never set (unlike the normal 1000 completion path).
    assert.strictEqual(client.closeCode, null);
    assert.ok(client.socket.destroyed);

    // The bad client didn't take the server down with it.
    const res = await post(port, '/api/sessions', { password: 'xyz' });
    assert.strictEqual(res.status, 201);
  } finally {
    server.close();
  }
});

test('disconnect before result discards the session (later connect gets 404)', async () => {
  const { server, port } = await startServer();
  try {
    const { body } = await post(port, '/api/sessions', { password: 'abc123' });
    const client = await wsConnect(port, body.sessionId);
    client.socket.destroy(); // abrupt disconnect before result
    await client.waitForClose();
    await new Promise((r) => setTimeout(r, 50));

    const retry = await wsConnect(port, body.sessionId);
    await retry.waitForClose();
    assert.deepStrictEqual(retry.messages, [{ type: 'error', code: 404, error: 'session_not_found' }]);
    assert.strictEqual(retry.closeCode, 4404);
  } finally {
    server.close();
  }
});
