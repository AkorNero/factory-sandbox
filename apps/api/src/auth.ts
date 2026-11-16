import { exportJWK, generateKeyPair, importJWK, SignJWT, type CryptoKey, type JWK } from 'jose';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const AUDIENCE = 'dayplanner';
export const ISSUER = 'dayplanner-api';
/** PowerSync rejects tokens that live longer than 24 h and recommends minutes. The device identity is long-lived, the token is not. */
export const TOKEN_TTL = '60m';
const ALG = 'RS256';

export interface Key {
  kid: string;
  privateKey: CryptoKey;
  /** Public parts only, as served in the JWKS. */
  publicJwk: JWK;
  /** What gets persisted (private JWK). */
  privateJwk: JWK;
}

async function fromPrivateJwk(privateJwk: JWK): Promise<Key> {
  const { d, p, q, dp, dq, qi, ...publicJwk } = privateJwk;
  void d, void p, void q, void dp, void dq, void qi;
  return {
    kid: privateJwk.kid!,
    privateKey: (await importJWK(privateJwk, ALG)) as CryptoKey,
    publicJwk: { ...publicJwk, alg: ALG, use: 'sig' },
    privateJwk,
  };
}

export async function generateKey(): Promise<Key> {
  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(privateKey);
  return fromPrivateJwk({ ...jwk, kid: `dayplanner-${Date.now().toString(36)}`, alg: ALG, use: 'sig' });
}

/**
 * The signing key survives restarts, so PowerSync's cached JWKS stays valid and devices keep working.
 * Read from the file if it exists, else generate and write it (owner-only).
 */
export async function loadOrCreateKey(file: string): Promise<Key> {
  if (existsSync(file)) return fromPrivateJwk(JSON.parse(readFileSync(file, 'utf8')) as JWK);
  const key = await generateKey();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(key.privateJwk), { mode: 0o600 });
  return key;
}

export const jwks = (key: Key) => ({ keys: [key.publicJwk] });

/** A short-lived JWT for one device. No login: trust comes from the tailnet. */
export async function signDeviceToken(key: Key, deviceId: string): Promise<string> {
  return new SignJWT({ device: deviceId })
    .setProtectedHeader({ alg: ALG, kid: key.kid })
    .setSubject('owner')
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(key.privateKey);
}
