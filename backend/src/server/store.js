'use strict';

/**
 * In-memory session store per docs/api-contract.md "Session lifecycle".
 *
 * - No persistence across restarts.
 * - TTL: 5 minutes from creation; sessions with no WebSocket connection are
 *   discarded when the TTL lapses.
 * - Once a WebSocket has connected, the session is exempt from TTL discard
 *   until its `result` is sent.
 * - Completed sessions leave a short-lived tombstone so a reconnect can be
 *   answered with 409 session_completed instead of 404.
 *
 * The store never sees or stores the raw password — callers hand it a
 * password-free plan/timeline computed synchronously at POST time.
 */

const crypto = require('node:crypto');

const SESSION_TTL_MS = 5 * 60 * 1000;

class SessionStore {
  constructor({ ttlMs = SESSION_TTL_MS, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.sessions = new Map(); // id -> session
    this.completed = new Map(); // id -> tombstone expiry (ms epoch)
  }

  /**
   * @param {object} plan password-free crack plan (buildCrackPlan output)
   * @param {Array} timeline precomputed attempt timeline (buildAttemptTimeline output)
   */
  create(plan, timeline) {
    const id = crypto.randomUUID(); // crypto-secure, ~122 bits, URL-safe
    const session = {
      id,
      createdAt: this.now(),
      plan,
      timeline,
      connected: false, // true while a WebSocket is attached
      everConnected: false,
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    this.sweep();
    return this.sessions.get(id) || null;
  }

  /** Discard a session outright (client disconnected before result, etc.). */
  discard(id) {
    this.sessions.delete(id);
  }

  /** Discard the record and leave a completed tombstone. */
  markCompleted(id) {
    this.sessions.delete(id);
    this.completed.set(id, this.now() + this.ttlMs);
  }

  isCompleted(id) {
    this.sweep();
    return this.completed.has(id);
  }

  /** Drop expired unconnected sessions and expired tombstones. */
  sweep() {
    const now = this.now();
    for (const [id, session] of this.sessions) {
      const expired = now - session.createdAt > this.ttlMs;
      if (expired && !session.connected) this.sessions.delete(id);
    }
    for (const [id, expiry] of this.completed) {
      if (now > expiry) this.completed.delete(id);
    }
  }

  size() {
    return this.sessions.size;
  }
}

module.exports = { SessionStore, SESSION_TTL_MS };
