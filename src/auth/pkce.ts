// PKCE helpers (RFC 7636).

const VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/** A 64-character verifier drawn from the unreserved charset, without modulo bias. */
export function generateVerifier(length = 64): string {
  const n = VERIFIER_CHARSET.length; // 66
  const limit = 256 - (256 % n); // reject bytes >= 198 so every char is equally likely
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit) out += VERIFIER_CHARSET[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function generateState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}
