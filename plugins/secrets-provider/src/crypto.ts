/**
 * secrets-provider — field cryptography (REAL WebCrypto, no mock).
 *
 * ─── HONEST CRYPTO NOTE (C-NOSTUB-001) ──────────────────────────────────────
 * Key derivation here is **PBKDF2-HMAC-SHA-256** (≥210 000 iterations, OWASP
 * 2023 floor), NOT Argon2id. The `secrets` CID names **Argon2id** as the
 * vault-crypto KDF target (crates/vault-crypto: Argon2id + AES-256-GCM). The
 * browser/WebCrypto platform exposes **no native Argon2id**; bringing a WASM
 * Argon2 in is the dedicated `vault-crypto` port (Option A), tracked as a
 * follow-up. This provider therefore declares its KDF honestly as PBKDF2 and
 * does NOT claim Argon2id. Field encryption IS the real, CID-specified
 * primitive: **AES-256-GCM** (authenticated, 96-bit random IV per call).
 *
 * What is real here:
 *   - deriveKey(passphrase, salt): PBKDF2-SHA-256 → non-extractable AES-256-GCM CryptoKey.
 *   - encryptField(key, plaintext): AES-256-GCM with a fresh 12-byte getRandomValues IV.
 *   - decryptField(key, blob): AES-256-GCM open (throws on tamper / wrong key — the GCM tag).
 *   - randomBytes / sentinel helpers for salt + the KDF verification sentinel.
 *
 * Nothing here logs, returns, or persists plaintext or key material. The
 * derived key is non-extractable (`extractable: false`) so it cannot be read
 * back out of the CryptoKey even within the process.
 */

// PBKDF2 iteration count. OWASP 2023 minimum for PBKDF2-HMAC-SHA-256 is 210 000.
// (Argon2id would be the stronger target; see header.)
export const PBKDF2_ITERATIONS = 210_000;
export const KDF_ALGORITHM = 'pbkdf2-hmac-sha256';
/** AES-GCM IV length in bytes (96 bits — the GCM-recommended nonce size). */
export const GCM_IV_BYTES = 12;
/** KDF salt length in bytes. */
export const SALT_BYTES = 16;

/**
 * Resolve a real SubtleCrypto. Node 20+ and browsers expose `globalThis.crypto`
 * (WebCrypto). A missing SubtleCrypto is a real, narrowly-scoped error — never a
 * silent fallback to a weaker/fake primitive.
 */
function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error(
      'secrets-provider: WebCrypto SubtleCrypto is unavailable in this runtime; ' +
        'real AES-256-GCM/PBKDF2 cannot be performed (no mock crypto is used).',
    );
  }
  return c.subtle;
}

/** Cryptographically-secure random bytes via WebCrypto getRandomValues. */
export function randomBytes(length: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) {
    throw new Error('secrets-provider: WebCrypto getRandomValues is unavailable.');
  }
  const out = new Uint8Array(length);
  c.getRandomValues(out);
  return out;
}

/** A fresh KDF salt (public-by-design; stored alongside the vault state). */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_BYTES);
}

/**
 * Derive an AES-256-GCM key from a passphrase + salt via PBKDF2-SHA-256.
 *
 * The returned CryptoKey is **non-extractable**: the raw key bytes cannot be
 * read back out, satisfying master_key_only_while_unlocked (the key lives only
 * as an opaque handle in memory, dropped on lock()).
 *
 * @param passphrase transient master-password material (never stored/logged)
 * @param salt       public PBKDF2 salt
 */
export async function deriveKey(passphrase: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const s = subtle();
  // Import the passphrase as raw PBKDF2 key material (extractable: false).
  const baseKey = await s.importKey('raw', toArrayBuffer(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return s.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the AES key cannot be exported
    ['encrypt', 'decrypt'],
  );
}

/** An AES-256-GCM ciphertext blob: random IV + ciphertext(+tag), both base64. */
export interface CipherBlob {
  /** base64-encoded 12-byte GCM IV (random per encryption). */
  iv: string;
  /** base64-encoded AES-256-GCM ciphertext WITH the 128-bit auth tag appended. */
  ct: string;
}

/**
 * AES-256-GCM encrypt with a fresh random 12-byte IV. The auth tag is included
 * in `ct` (WebCrypto appends it). Returns base64 blob suitable for storing in a
 * replicated node body as an OPAQUE handle (never plaintext).
 */
export async function encryptField(key: CryptoKey, plaintext: Uint8Array): Promise<CipherBlob> {
  const s = subtle();
  const iv = randomBytes(GCM_IV_BYTES);
  const ctBuf = await s.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext));
  return { iv: bytesToB64(iv), ct: bytesToB64(new Uint8Array(ctBuf)) };
}

/**
 * AES-256-GCM decrypt. Throws if the key is wrong or the ciphertext/tag has been
 * tampered with (the GCM authentication tag fails) — this is what makes a wrong
 * passphrase / corrupted blob reveal nothing.
 */
export async function decryptField(key: CryptoKey, blob: CipherBlob): Promise<Uint8Array> {
  const s = subtle();
  const iv = b64ToBytes(blob.iv);
  const ct = b64ToBytes(blob.ct);
  const ptBuf = await s.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(ct));
  return new Uint8Array(ptBuf);
}

// ─── Encoding helpers ───────────────────────────────────────────────────────

/** Copy a Uint8Array's bytes into a standalone ArrayBuffer (WebCrypto BufferSource). */
function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u8.byteLength);
  new Uint8Array(out).set(u8);
  return out;
}

/**
 * Narrowly-typed accessor for the optional Node `Buffer` global (avoids a hard
 * @types/node dependency while staying type-safe). undefined in a pure browser.
 */
interface BufferCtor {
  from(data: Uint8Array): { toString(enc: string): string };
  from(data: string, enc: string): Uint8Array;
}
function nodeBuffer(): BufferCtor | undefined {
  return (globalThis as { Buffer?: BufferCtor }).Buffer;
}

/** UTF-8 encode a string to bytes. */
export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** UTF-8 decode bytes to a string. */
export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

/** Bytes → base64 (Node Buffer or btoa fallback). */
export function bytesToB64(bytes: Uint8Array): string {
  const B = nodeBuffer();
  if (B) return B.from(bytes).toString('base64');
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64 → bytes (Node Buffer or atob fallback). */
export function b64ToBytes(b64: string): Uint8Array {
  const B = nodeBuffer();
  if (B) return new Uint8Array(B.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
