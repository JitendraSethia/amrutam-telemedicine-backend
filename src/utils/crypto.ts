import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Field-level encryption for PII at rest (AES-256-GCM), with a versioned key
 * ring to support zero-downtime KEY ROTATION:
 *
 *   - `DATA_ENCRYPTION_KEYS` holds all keys as `kid:base64` (comma separated).
 *   - `DATA_ENCRYPTION_ACTIVE_KID` selects the key used for NEW writes.
 *   - Ciphertext is tagged with its `kid`, so old data stays readable after a
 *     rotation. Re-encryption to the active key happens lazily on write or via
 *     a background re-key job.
 *
 * Ciphertext envelope (string): `kid:iv_b64:tag_b64:ciphertext_b64`.
 */

type KeyRing = Map<string, Buffer>;

function parseKeyRing(): KeyRing {
  const ring: KeyRing = new Map();
  for (const entry of env.DATA_ENCRYPTION_KEYS.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) throw new Error(`Malformed DATA_ENCRYPTION_KEYS entry: ${trimmed}`);
    const kid = trimmed.slice(0, idx);
    const key = Buffer.from(trimmed.slice(idx + 1), 'base64');
    if (key.length !== 32) {
      throw new Error(`Encryption key "${kid}" must be 32 bytes (base64 of 256-bit key)`);
    }
    ring.set(kid, key);
  }
  if (!ring.has(env.DATA_ENCRYPTION_ACTIVE_KID)) {
    throw new Error(
      `DATA_ENCRYPTION_ACTIVE_KID "${env.DATA_ENCRYPTION_ACTIVE_KID}" not present in key ring`,
    );
  }
  return ring;
}

const keyRing = parseKeyRing();
const activeKid = env.DATA_ENCRYPTION_ACTIVE_KID;
// A separate derived key space for blind indexes so we never reuse the raw
// encryption key as an HMAC key.
const blindIndexKey = createHmac('sha256', keyRing.get(activeKid)!)
  .update('blind-index-derivation')
  .digest();

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const key = keyRing.get(activeKid)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${activeKid}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptField(envelope: string | null | undefined): string | null {
  if (envelope === null || envelope === undefined) return null;
  const parts = envelope.split(':');
  if (parts.length !== 4) throw new Error('Malformed ciphertext envelope');
  const [kid, ivB64, tagB64, dataB64] = parts;
  const key = keyRing.get(kid);
  if (!key) throw new Error(`Unknown encryption key id "${kid}" — cannot decrypt`);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/**
 * Deterministic keyed hash used as a "blind index": lets us do equality
 * lookups (e.g. find-user-by-email) on encrypted columns without decrypting,
 * while not storing the plaintext. Normalises case for case-insensitive fields.
 */
export function blindIndex(value: string, opts: { lowercase?: boolean } = {}): string {
  const normalized = opts.lowercase ? value.trim().toLowerCase() : value.trim();
  return createHmac('sha256', blindIndexKey).update(normalized).digest('hex');
}

/** Constant-time string comparison (avoids timing side-channels). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Cryptographically random opaque token (URL-safe base64). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** HMAC-SHA256 hex digest — used for webhook signature verification. */
export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
