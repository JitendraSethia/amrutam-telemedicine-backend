import { describe, it, expect } from 'vitest';
import { stableStringify, sha256Hex, fingerprint } from '../../src/utils/hash.js';

describe('stableStringify', () => {
  it('is key-order independent (critical for idempotency request hashing)', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });
  it('is order-independent recursively but preserves array order', () => {
    expect(stableStringify({ x: { p: 1, q: 2 } })).toBe(stableStringify({ x: { q: 2, p: 1 } }));
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });
});

describe('fingerprint', () => {
  it('changes when any scoping part changes', () => {
    const base = fingerprint(['user1', 'POST', '/bookings', 'key1']);
    expect(base).toBe(fingerprint(['user1', 'POST', '/bookings', 'key1']));
    expect(base).not.toBe(fingerprint(['user2', 'POST', '/bookings', 'key1']));
    expect(base).not.toBe(fingerprint(['user1', 'POST', '/bookings', 'key2']));
  });
  it('treats undefined parts as empty', () => {
    expect(fingerprint([undefined, 'GET', '/x', 'k'])).toBe(fingerprint(['', 'GET', '/x', 'k']));
  });
});

describe('sha256Hex', () => {
  it('is 64 hex chars', () => {
    expect(sha256Hex('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
