'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { SessionStore } = require('../src/server/store');

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

const plan = { score: 1, targetCrackTimeMs: 9000, stages: ['dictionary'] };

test('create returns a URL-safe crypto id and stores the session', () => {
  const store = new SessionStore();
  const session = store.create(plan, []);
  assert.match(session.id, /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(store.get(session.id), session);
});

test('ids are unique across sessions', () => {
  const store = new SessionStore();
  const ids = new Set();
  for (let i = 0; i < 1000; i += 1) ids.add(store.create(plan, []).id);
  assert.strictEqual(ids.size, 1000);
});

test('unconnected session expires after TTL', () => {
  const clock = makeClock();
  const store = new SessionStore({ ttlMs: 1000, now: clock.now });
  const { id } = store.create(plan, []);
  clock.advance(999);
  assert.ok(store.get(id));
  clock.advance(2);
  assert.strictEqual(store.get(id), null);
});

test('connected session is exempt from TTL discard', () => {
  const clock = makeClock();
  const store = new SessionStore({ ttlMs: 1000, now: clock.now });
  const session = store.create(plan, []);
  session.connected = true;
  clock.advance(5000);
  assert.strictEqual(store.get(session.id), session);
});

test('discard removes the session immediately', () => {
  const store = new SessionStore();
  const { id } = store.create(plan, []);
  store.discard(id);
  assert.strictEqual(store.get(id), null);
  assert.strictEqual(store.isCompleted(id), false);
});

test('markCompleted removes record and leaves a 409 tombstone that expires', () => {
  const clock = makeClock();
  const store = new SessionStore({ ttlMs: 1000, now: clock.now });
  const { id } = store.create(plan, []);
  store.markCompleted(id);
  assert.strictEqual(store.get(id), null);
  assert.strictEqual(store.isCompleted(id), true);
  clock.advance(1001);
  assert.strictEqual(store.isCompleted(id), false);
});
