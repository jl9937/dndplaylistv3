import { describe, expect, it } from 'vitest';
import { challengeS256, generateState, generateVerifier } from '../src/auth/pkce';

describe('pkce', () => {
  it('generates a 64-char verifier from the unreserved charset', () => {
    for (let i = 0; i < 50; i++) {
      const v = generateVerifier();
      expect(v).toHaveLength(64);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it('matches the RFC 7636 appendix B S256 vector', async () => {
    expect(await challengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates url-safe, distinct states', () => {
    const a = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(generateState()).not.toBe(a);
  });
});
