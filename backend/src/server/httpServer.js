'use strict';

/**
 * Operation Vault Breach — Day 2 backend service.
 *
 * Implements docs/api-contract.md with Node built-ins only (the dev sandbox
 * cannot reach the npm registry, and the event kiosks have no internet
 * dependency):
 *
 * - POST /api/sessions        -> create session, return { sessionId, plan }
 * - WS   /ws/sessions/:id     -> stream attempt/stage/result events
 * - GET  /                    -> serve the kiosk frontend (../../frontend)
 *
 * The raw password is used synchronously to compute the plan and never
 * stored, logged, or echoed back.
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const defaultEngine = require('../engine');
const defaultPrize = require('../prize/prizeCode');
const { SessionStore } = require('./store');
const { createRateLimiter, DEFAULT_WINDOW_MS } = require('./rateLimit');
const { acceptKey, encodeText, encodeClose, encodePong, FrameParser, OPCODES } = require('./wsFrames');

const MAX_BODY_BYTES = 4096;
const WS_PATH_RE = /^\/ws\/sessions\/([A-Za-z0-9_-]+)$/;
const FRONTEND_DIR = path.join(__dirname, '..', '..', '..', 'frontend');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

/** Public plan shape per the contract — never leaks attemptPool internals. */
function publicPlan(plan) {
  return {
    score: plan.score,
    entropyBits: plan.entropyBits,
    dictionaryHit: plan.dictionaryHit,
    targetCrackTimeMs: plan.targetCrackTimeMs,
    stages: plan.stages,
  };
}

/**
 * Merge stage starts, attempt ticker lines, and the terminal result into one
 * time-ordered event list. Stage events sort ahead of attempts at the same
 * timestamp; result is always last.
 */
function buildEventList(engine, plan, timeline) {
  const events = [];
  for (const { stage, startMs } of engine.computeStageDurations(plan)) {
    events.push({ atMs: startMs, order: 0, msg: { type: 'stage', stage } });
  }
  for (const item of timeline) {
    events.push({
      atMs: item.elapsedMs,
      order: 1,
      msg: { type: 'attempt', text: item.text, elapsedMs: item.elapsedMs },
    });
  }
  events.sort((a, b) => a.atMs - b.atMs || a.order - b.order);
  return events;
}

function createServer({ engine = defaultEngine, prize = defaultPrize, store, rateLimiter, now = Date.now } = {}) {
  const sessions = store || new SessionStore({ now });
  const limiter = rateLimiter || createRateLimiter({ now });

  // Bound the limiter's per-IP map over a long event; unref so it never
  // holds the process open, and clear it once the server itself closes.
  const sweepTimer = setInterval(() => limiter.sweep(), DEFAULT_WINDOW_MS);
  sweepTimer.unref();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/sessions') {
      handleCreateSession(req, res);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/admin/redeem') {
      handleAdminRedeem(req, res);
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/admin/ledger') {
      json(res, 200, { codes: prize.getLedger() });
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/admin/leaderboard') {
      json(res, 200, { leaderboard: prize.getLeaderboard() });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(url.pathname, res);
      return;
    }

    json(res, 404, { error: 'not_found' });
  });

  function handleCreateSession(req, res) {
    const ip = req.socket.remoteAddress || 'unknown';
    if (!limiter.check(ip)) {
      json(res, 429, { error: 'rate_limited' });
      return;
    }

    let body = '';
    let overflow = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('close', () => {
      if (overflow) return; // connection torn down, nothing to answer
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        json(res, 400, { error: 'invalid_request' });
        return;
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        json(res, 400, { error: 'invalid_request' });
        return;
      }

      const { password } = parsed;
      if (typeof password !== 'string' || password.length < 1 || password.length > 6) {
        json(res, 400, { error: 'invalid_password' });
        return;
      }

      // The password is consumed synchronously here and never retained:
      // the plan and timeline are password-free (contract: display strings
      // never contain the real password).
      const plan = engine.buildCrackPlan(password);
      const timeline = engine.buildAttemptTimeline(plan);

      const session = sessions.create(plan, timeline);
      session.events = buildEventList(engine, plan, timeline);

      json(res, 201, { sessionId: session.id, plan: publicPlan(plan) });
    });
    req.on('error', () => {});
  }

  function handleAdminRedeem(req, res) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) req.destroy();
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        json(res, 400, { error: 'invalid_request' });
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        json(res, 400, { error: 'invalid_request' });
        return;
      }
      const { code } = parsed;
      if (typeof code !== 'string' || code.length === 0) {
        json(res, 400, { error: 'invalid_code' });
        return;
      }
      const result = prize.redeemCode(code);
      if (!result.ok) {
        const status = result.error === 'already_redeemed' ? 409 : 404;
        json(res, status, { error: result.error });
        return;
      }
      json(res, 200, { ok: true });
    });
    req.on('error', () => {});
  }

  function serveStatic(pathname, res) {
    let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.normalize(path.join(FRONTEND_DIR, rel));
    if (!filePath.startsWith(FRONTEND_DIR)) {
      json(res, 404, { error: 'not_found' });
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        json(res, 404, { error: 'not_found' });
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Content-Length': data.length,
      });
      res.end(data);
    });
  }

  // ---------------------------------------------------------------------
  // WebSocket upgrade + session streaming
  // ---------------------------------------------------------------------

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    const match = WS_PATH_RE.exec(url.pathname);
    const key = req.headers['sec-websocket-key'];

    if (!match || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    // Complete the handshake first: browser WebSocket clients can't read a
    // rejected upgrade, so errors are delivered as one JSON message + close
    // code on an accepted socket (contract: "Error responses").
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`,
    );
    socket.setNoDelay(true);

    const sessionId = match[1];
    const send = (obj) => {
      if (!socket.destroyed) socket.write(encodeText(JSON.stringify(obj)));
    };
    const sendErrorAndClose = (httpCode, error, wsCloseCode) => {
      send({ type: 'error', code: httpCode, error });
      if (!socket.destroyed) socket.write(encodeClose(wsCloseCode, error));
      socket.end();
    };

    if (sessions.isCompleted(sessionId)) {
      sendErrorAndClose(409, 'session_completed', 4409);
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      sendErrorAndClose(404, 'session_not_found', 4404);
      return;
    }
    if (session.connected) {
      sendErrorAndClose(409, 'session_in_use', 4409);
      return;
    }

    session.connected = true;
    session.everConnected = true;

    let timer = null;
    let index = 0;
    let done = false;

    const finish = () => {
      done = true;
      if (timer) clearTimeout(timer);
      const revealMs = now() - session.createdAt;
      send({
        type: 'result',
        success: true,
        prizeCode: prize.generatePrizeCode({ revealMs }),
        revealMs,
      });
      sessions.markCompleted(session.id);
      if (!socket.destroyed) socket.write(encodeClose(1000, 'result_sent'));
      socket.end();
    };

    // Drive pacing off the precomputed plan; the crack clock started at POST
    // time, so a late-connecting client is fast-forwarded through past events.
    const pump = () => {
      if (done || socket.destroyed) return;
      const elapsed = now() - session.createdAt;

      while (index < session.events.length && session.events[index].atMs <= elapsed) {
        send(session.events[index].msg);
        index += 1;
      }

      if (elapsed >= session.plan.targetCrackTimeMs) {
        // Flush any stragglers (stage events must all precede result).
        while (index < session.events.length) {
          send(session.events[index].msg);
          index += 1;
        }
        finish();
        return;
      }

      const nextAt = index < session.events.length
        ? Math.min(session.events[index].atMs, session.plan.targetCrackTimeMs)
        : session.plan.targetCrackTimeMs;
      timer = setTimeout(pump, Math.max(1, nextAt - (now() - session.createdAt)));
    };

    const parser = new FrameParser();
    socket.on('data', (chunk) => {
      let frames;
      try {
        frames = parser.push(chunk);
      } catch {
        socket.destroy();
        return;
      }
      for (const frame of frames) {
        if (frame.opcode === OPCODES.CLOSE) {
          socket.end(encodeClose(1000));
        } else if (frame.opcode === OPCODES.PING) {
          socket.write(encodePong(frame.payload));
        }
        // Client text frames are ignored — the stream is server-driven.
      }
    });

    const teardown = () => {
      if (timer) clearTimeout(timer);
      if (!done) {
        // Disconnected before result: discard immediately (no reconnect).
        sessions.discard(session.id);
      }
    };
    socket.on('close', teardown);
    // http.Server upgrade sockets behave half-open: the client's FIN arrives
    // as 'end' and 'close' won't fire until we shut our side down too.
    socket.on('end', () => socket.end());
    socket.on('error', () => socket.destroy());

    pump();
  });

  server.on('close', () => clearInterval(sweepTimer));

  server.sessions = sessions;
  return server;
}

module.exports = { createServer, buildEventList, publicPlan };
