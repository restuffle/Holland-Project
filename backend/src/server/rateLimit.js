'use strict';

/**
 * Simple in-memory fixed-window rate limiter, keyed by client IP.
 * Dependency-free stand-in for express-rate-limit (contract only requires
 * that POST /api/sessions is rate limited per IP/station to bound in-memory
 * session growth).
 */

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX = 20; // one kiosk should never legitimately exceed this

function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max = DEFAULT_MAX, now = Date.now } = {}) {
  const hits = new Map(); // ip -> { count, windowStart }

  function check(ip) {
    const t = now();
    const entry = hits.get(ip);
    if (!entry || t - entry.windowStart >= windowMs) {
      hits.set(ip, { count: 1, windowStart: t });
      return true;
    }
    entry.count += 1;
    if (entry.count > max) return false;
    return true;
  }

  // Occasional cleanup so the map doesn't grow unbounded over a long event.
  function sweep() {
    const t = now();
    for (const [ip, entry] of hits) {
      if (t - entry.windowStart >= windowMs) hits.delete(ip);
    }
  }

  return { check, sweep };
}

module.exports = { createRateLimiter, DEFAULT_WINDOW_MS, DEFAULT_MAX };
