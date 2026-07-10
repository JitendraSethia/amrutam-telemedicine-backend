import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  signMfaToken,
  verifyMfaToken,
} from '../../src/modules/auth/tokens.js';

describe('access tokens', () => {
  it('round-trips claims', () => {
    const token = signAccessToken({
      sub: 'u1',
      role: 'patient',
      email: 'a@b.com',
      mfa: true,
      sid: 's1',
    });
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('u1');
    expect(claims.role).toBe('patient');
    expect(claims.mfa).toBe(true);
  });

  it('rejects a tampered token', () => {
    const token = signAccessToken({ sub: 'u1', role: 'patient', email: 'a@b.com', mfa: false, sid: 's1' });
    expect(() => verifyAccessToken(token + 'x')).toThrow();
  });
});

describe('MFA challenge token isolation', () => {
  it('an MFA token cannot be used as an access token (audience mismatch)', () => {
    const mfa = signMfaToken('u1');
    expect(verifyMfaToken(mfa).sub).toBe('u1');
    // Different audience → access verification must reject it.
    expect(() => verifyAccessToken(mfa)).toThrow();
  });

  it('an access token cannot satisfy the MFA verifier', () => {
    const access = signAccessToken({ sub: 'u1', role: 'patient', email: 'a@b.com', mfa: false, sid: 's1' });
    expect(() => verifyMfaToken(access)).toThrow();
  });
});
