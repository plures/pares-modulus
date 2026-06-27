/**
 * secrets-provider - the REAL `secrets@1.x` conformance provider.
 *
 * Implements the non-deferred surface of the `secrets` CID
 * (pares-radix/capabilities/secrets.cid.toml) over the live `ctx.data`
 * collection bridge. Every secret value is AES-256-GCM encrypted (src/crypto.ts)
 * BEFORE it is persisted; plaintext crosses the boundary ONLY through the
 * unlock-gated `retrieve` / `get_metadata` operations.
 *
 * Persistence (C-PLURES-003/004 - all via ctx.data.collection, no localStorage):
 *   - "vault_state"               : one node per vault. PUBLIC fields only -
 *                                   KDF salt + params + a KDF verification
 *                                   SENTINEL (an AES-GCM blob of a fixed token).
 *                                   NO key, NO passphrase, NO plaintext secret.
 *   - "credential_meta"           : one node per credential. Metadata + an OPAQUE
 *                                   ciphertext blob {iv,ct} (base64). Never the
 *                                   cleartext (secrets_never_in_node_body).
 *   - "credential_metadata_entry" : per-credential extra attributes; the VALUE is
 *                                   an opaque ciphertext blob; the key is plaintext.
 *   - "sync_state"                : per-credential sync bookkeeping (non-secret).
 *
 * Unlock state is IN-MEMORY ONLY (a Map<vaultId, UnlockState>) and is dropped on
 * lock() (master_key_only_while_unlocked). The derived key is a non-extractable
 * CryptoKey (src/crypto.ts), so even in memory the raw key bytes are unreadable.
 *
 * Deferred (C-NOSTUB-001 - honest, never faked): `rotate` and `link` are real
 * functions that return E_NOT_IMPLEMENTED. They do NOT fake success.
 */

import type { PluginContext } from '@plures/pares-radix';
import {
  type CipherBlob,
  deriveKey,
  encryptField,
  decryptField,
  generateSalt,
  bytesToB64,
  b64ToBytes,
  utf8,
  fromUtf8,
  KDF_ALGORITHM,
  PBKDF2_ITERATIONS,
} from './crypto.js';

// ─── Error codes (from the CID `errors` lists) ──────────────────────────────

export type SecretsErrorCode =
  | 'E_INVALID_PASSPHRASE'
  | 'E_VAULT_NOT_INITIALIZED'
  | 'E_VAULT_LOCKED'
  | 'E_ALREADY_EXISTS'
  | 'E_NOT_FOUND'
  | 'E_NOT_IMPLEMENTED';

/**
 * A mediated-boundary error carrying a stable CID error code. The message is
 * metadata-only and NEVER contains plaintext secret material or key/passphrase
 * (secrets_never_logged).
 */
export class SecretsError extends Error {
  readonly code: SecretsErrorCode;
  constructor(code: SecretsErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'SecretsError';
    this.code = code;
  }
}

// ─── Node shapes (mirror the CID [[nodes]] - metadata + opaque ciphertext) ──

export type SecretNodeKind = 'credential' | 'group' | 'tag' | 'environment' | 'service';

/** secrets:credential_meta - replicated. Metadata + OPAQUE ciphertext blobs. */
export interface CredentialMeta {
  id: string;
  title: string;
  type: SecretNodeKind;
  username?: string;
  url?: string;
  /** OPAQUE AES-256-GCM handle for the secret. NEVER plaintext. */
  ciphertext_handle: CipherBlob;
  /** OPAQUE AES-256-GCM handle for optional notes. NEVER plaintext. */
  notes_handle?: CipherBlob;
  created: string;
  rotated: string;
}

/** Metadata-only projection of a credential (ciphertext handles stripped). */
export type CredentialMetaPublic = Omit<CredentialMeta, 'ciphertext_handle' | 'notes_handle'> & {
  has_notes: boolean;
};

/** secrets:credential_metadata_entry - value is an OPAQUE ciphertext handle. */
export interface CredentialMetadataEntry {
  credential_id: string;
  key: string;
  value_handle: CipherBlob;
}

/** secrets:vault_state - PUBLIC descriptor. No key/passphrase/plaintext. */
export interface VaultStateNode {
  vault_id: string;
  vault_name: string;
  kdf_algorithm: string;
  kdf_iterations: number;
  /** base64 public PBKDF2 salt (not secret). */
  salt: string;
  /** KDF verification sentinel: AES-GCM blob of a fixed token, used to reject
   *  wrong passphrases BEFORE any access (wrong_passphrase_reveals_nothing). */
  verifier: CipherBlob;
  created: string;
}

/** secrets:sync_state - per-credential sync bookkeeping (non-secret). */
export interface SyncStateNode {
  credential_id: string;
  last_sync: string;
  sync_hash: string;
}

// ─── Operation I/O shapes ───────────────────────────────────────────────────

export interface UnlockInput {
  vault_id: string;
  passphrase: Uint8Array;
  /** Optional human-readable name, used only when initializing a new vault. */
  vault_name?: string;
}
export interface VaultStatePublic {
  vault_id: string;
  vault_name: string;
  unlocked: boolean;
  kdf_algorithm: string;
  kdf_iterations: number;
  salt: string;
  created: string;
}
export interface UnlockOutput {
  unlocked: boolean;
  vault: VaultStatePublic;
}

export interface StoreInput {
  vault_id: string;
  title: string;
  secret: Uint8Array;
  type?: SecretNodeKind;
  username?: string;
  url?: string;
  notes?: Uint8Array;
}

export interface RetrieveInput {
  vault_id: string;
  id?: string;
  title?: string;
}
export interface RetrieveOutput {
  secret: Uint8Array;
  notes?: Uint8Array;
  credential: CredentialMetaPublic;
}

export interface UpdateInput {
  vault_id: string;
  id?: string;
  title?: string;
  new_title?: string;
  secret?: Uint8Array;
  username?: string;
  url?: string;
  notes?: Uint8Array;
}

/** The deferred-op honest result shape (never a fake success). */
export interface DeferredResult {
  deferred: true;
  code: 'E_NOT_IMPLEMENTED';
  reason: string;
}

/** The provider's public, mediated API surface. */
export interface SecretsProvider {
  // lifecycle
  unlock(input: UnlockInput): Promise<UnlockOutput>;
  lock(input: { vault_id: string }): Promise<{ unlocked: boolean }>;
  is_unlocked(input: { vault_id: string }): Promise<{ unlocked: boolean }>;
  // credentials
  store(input: StoreInput): Promise<{ credential: CredentialMetaPublic }>;
  retrieve(input: RetrieveInput): Promise<RetrieveOutput>;
  list_metadata(input: { vault_id: string }): Promise<{ credentials: CredentialMetaPublic[] }>;
  update(input: UpdateInput): Promise<{ credential: CredentialMetaPublic }>;
  delete(input: RetrieveInput): Promise<{ deleted: boolean }>;
  // per-credential metadata entries
  set_metadata(input: {
    vault_id: string;
    credential_id: string;
    key: string;
    value: Uint8Array;
  }): Promise<{ entry: { credential_id: string; key: string } }>;
  get_metadata(input: {
    vault_id: string;
    credential_id: string;
  }): Promise<{ entries: Array<{ key: string; value: Uint8Array }> }>;
  delete_metadata(input: {
    vault_id: string;
    credential_id: string;
    key: string;
  }): Promise<{ deleted: boolean }>;
  // sync bookkeeping
  record_sync(input: {
    vault_id: string;
    credential_id: string;
    sync_hash: string;
  }): Promise<{ sync: SyncStateNode }>;
  // deferred (honest E_NOT_IMPLEMENTED - never faked)
  rotate(input: unknown): Promise<DeferredResult>;
  link(input: unknown): Promise<DeferredResult>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const COLL_VAULT = 'vault_state';
const COLL_CRED = 'credential_meta';
const COLL_META = 'credential_metadata_entry';
const COLL_SYNC = 'sync_state';

/** Fixed sentinel plaintext encrypted under the master key to verify passphrase.
 *  Public/non-secret by design - its only purpose is GCM-tag verification. */
const VERIFIER_SENTINEL = 'secrets-provider/kdf-verification/v1';

/** Composite metadata-entry id: one node per (credential_id, key). */
const metaId = (credentialId: string, key: string) => `${credentialId}::${key}`;

/** Project a credential to metadata only (strip every ciphertext handle). */
function stripSecrets(c: CredentialMeta): CredentialMetaPublic {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    username: c.username,
    url: c.url,
    has_notes: c.notes_handle !== undefined,
    created: c.created,
    rotated: c.rotated,
  };
}

/** A random UUID for credential ids (WebCrypto randomUUID). */
function cryptoRandomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback: 16 random bytes hex (still cryptographically random).
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ─── In-memory unlock state (dropped on lock) ───────────────────────────────

interface UnlockState {
  key: CryptoKey;
}

/**
 * Construct the secrets provider over a PluginContext. All persistence flows
 * through ctx.data.collection(); unlock state is in-memory only.
 */
export function createSecretsProvider(ctx: PluginContext): SecretsProvider {
  // Per-vault derived key, held ONLY between unlock and lock. Never persisted.
  const unlocked = new Map<string, UnlockState>();

  const vaults = ctx.data.collection<VaultStateNode>(COLL_VAULT);
  const creds = ctx.data.collection<CredentialMeta>(COLL_CRED);
  const metas = ctx.data.collection<CredentialMetadataEntry>(COLL_META);
  const syncs = ctx.data.collection<SyncStateNode>(COLL_SYNC);

  // ── internal helpers ──────────────────────────────────────────────────────

  /** Require an unlocked vault; throw E_VAULT_LOCKED (no plaintext) otherwise. */
  function requireKey(vaultId: string): CryptoKey {
    const st = unlocked.get(vaultId);
    if (!st) throw new SecretsError('E_VAULT_LOCKED', `vault "${vaultId}" is locked`);
    return st.key;
  }

  function toPublic(node: VaultStateNode, isUnlocked: boolean): VaultStatePublic {
    return {
      vault_id: node.vault_id,
      vault_name: node.vault_name,
      unlocked: isUnlocked,
      kdf_algorithm: node.kdf_algorithm,
      kdf_iterations: node.kdf_iterations,
      salt: node.salt,
      created: node.created,
    };
  }

  /** Resolve a credential by id or title (one required). null if not found. */
  async function findCredential(input: {
    id?: string;
    title?: string;
  }): Promise<CredentialMeta | null> {
    if (input.id) {
      return (await creds.get(input.id)) ?? null;
    }
    if (input.title) {
      const all = await creds.query();
      return all.find((c) => c.title === input.title) ?? null;
    }
    throw new SecretsError('E_NOT_FOUND', 'either id or title is required');
  }

  // ── operations ────────────────────────────────────────────────────────────

  return {
    /**
     * unlock - derive the master key from the passphrase and verify it against
     * the stored KDF sentinel. First unlock of a fresh vault INITIALIZES it
     * (generates salt + writes the verifier). Wrong passphrase on an existing
     * vault → E_INVALID_PASSPHRASE, with NO access granted.
     */
    async unlock(input: UnlockInput): Promise<UnlockOutput> {
      const existing = await vaults.get(input.vault_id);

      if (!existing) {
        // Initialize a new vault: fresh salt, derive key, store a verifier.
        const salt = generateSalt();
        const key = await deriveKey(input.passphrase, salt);
        const verifier = await encryptField(key, utf8(VERIFIER_SENTINEL));
        const node: VaultStateNode = {
          vault_id: input.vault_id,
          vault_name: input.vault_name ?? input.vault_id,
          kdf_algorithm: KDF_ALGORITHM,
          kdf_iterations: PBKDF2_ITERATIONS,
          salt: bytesToB64(salt),
          verifier,
          created: new Date().toISOString(),
        };
        await vaults.put(node.vault_id, node);
        unlocked.set(input.vault_id, { key });
        return { unlocked: true, vault: toPublic(node, true) };
      }

      // Existing vault: re-derive the key from the supplied passphrase + stored
      // salt, then VERIFY by decrypting the sentinel. GCM-tag failure (wrong
      // passphrase) throws → mapped to E_INVALID_PASSPHRASE. No access until ok.
      const saltBytes = b64ToBytes(existing.salt);
      const key = await deriveKey(input.passphrase, saltBytes);
      try {
        const opened = await decryptField(key, existing.verifier);
        if (fromUtf8(opened) !== VERIFIER_SENTINEL) {
          throw new Error('sentinel mismatch');
        }
      } catch {
        // Wrong passphrase reveals nothing: no key is set, no plaintext returned.
        throw new SecretsError('E_INVALID_PASSPHRASE', 'master passphrase verification failed');
      }
      unlocked.set(input.vault_id, { key });
      return { unlocked: true, vault: toPublic(existing, true) };
    },

    /** lock - drop the in-memory master key. After this, reads fail until unlock. */
    async lock(input: { vault_id: string }): Promise<{ unlocked: boolean }> {
      unlocked.delete(input.vault_id);
      return { unlocked: false };
    },

    /** is_unlocked - pure state query (master_key present?). No secret material. */
    async is_unlocked(input: { vault_id: string }): Promise<{ unlocked: boolean }> {
      return { unlocked: unlocked.has(input.vault_id) };
    },

    /**
     * store - encrypt the secret (and optional notes) BEFORE persisting; the
     * replicated node carries metadata + opaque ciphertext only. Unlock-gated.
     */
    async store(input: StoreInput): Promise<{ credential: CredentialMetaPublic }> {
      const key = requireKey(input.vault_id);

      // Duplicate-title guard (CID E_ALREADY_EXISTS).
      const dup = (await creds.query()).find((c) => c.title === input.title);
      if (dup) {
        throw new SecretsError('E_ALREADY_EXISTS', `credential "${input.title}" already exists`);
      }

      const id = cryptoRandomId();
      const now = new Date().toISOString();
      const ciphertext_handle = await encryptField(key, input.secret);
      const notes_handle = input.notes ? await encryptField(key, input.notes) : undefined;

      const node: CredentialMeta = {
        id,
        title: input.title,
        type: input.type ?? 'credential',
        username: input.username,
        url: input.url,
        ciphertext_handle,
        notes_handle,
        created: now,
        rotated: now,
      };
      await creds.put(id, node);
      // Result is METADATA ONLY - never the plaintext (CID `store` output).
      return { credential: stripSecrets(node) };
    },

    /**
     * retrieve - THE unlock-gated plaintext crossing. Decrypts and returns the
     * secret (and notes) ONLY while unlocked; locked → E_VAULT_LOCKED, no plaintext.
     */
    async retrieve(input: RetrieveInput): Promise<RetrieveOutput> {
      const key = requireKey(input.vault_id); // throws E_VAULT_LOCKED if locked
      const node = await findCredential(input);
      if (!node) throw new SecretsError('E_NOT_FOUND', 'credential not found');
      const secret = await decryptField(key, node.ciphertext_handle);
      const notes = node.notes_handle ? await decryptField(key, node.notes_handle) : undefined;
      return { secret, notes, credential: stripSecrets(node) };
    },

    /**
     * list_metadata - returns credential METADATA only, with secret/notes
     * ciphertext STRIPPED (no opaque handle, no plaintext). Unlock-gated.
     */
    async list_metadata(input: {
      vault_id: string;
    }): Promise<{ credentials: CredentialMetaPublic[] }> {
      requireKey(input.vault_id); // unlock-gated per CID
      const all = await creds.query();
      // Project OUT the ciphertext handles entirely - metadata only.
      const credentials = all
        .map((c) => stripSecrets(c))
        .sort((a, b) => a.title.localeCompare(b.title));
      return { credentials };
    },

    /**
     * update - change credential fields in place; re-encrypt changed secret/notes
     * under the master key and bump `rotated`. Unlock-gated. (This is the
     * change-in-place path the CID points to instead of a first-class rotate.)
     */
    async update(input: UpdateInput): Promise<{ credential: CredentialMetaPublic }> {
      const key = requireKey(input.vault_id);
      const node = await findCredential(input);
      if (!node) throw new SecretsError('E_NOT_FOUND', 'credential not found');

      const updated: CredentialMeta = { ...node };
      if (input.new_title !== undefined) updated.title = input.new_title;
      if (input.username !== undefined) updated.username = input.username;
      if (input.url !== undefined) updated.url = input.url;
      if (input.secret !== undefined) {
        updated.ciphertext_handle = await encryptField(key, input.secret);
      }
      if (input.notes !== undefined) {
        updated.notes_handle = await encryptField(key, input.notes);
      }
      updated.rotated = new Date().toISOString();
      await creds.put(updated.id, updated);
      return { credential: stripSecrets(updated) };
    },

    /**
     * delete - remove the credential and CASCADE its metadata + sync nodes
     * (delete_cascades) so no orphaned ciphertext handle or sync record is left.
     * Not unlock-gated (removes ciphertext without decrypting), per CID note.
     */
    async delete(input: RetrieveInput): Promise<{ deleted: boolean }> {
      const node = await findCredential(input);
      if (!node) return { deleted: false };

      // Cascade: metadata entries for this credential.
      const entries = (await metas.query()).filter((e) => e.credential_id === node.id);
      for (const e of entries) await metas.delete(metaId(e.credential_id, e.key));
      // Cascade: sync node.
      await syncs.delete(node.id);
      // Finally the credential node itself.
      await creds.delete(node.id);
      return { deleted: true };
    },

    /**
     * set_metadata - encrypt the value BEFORE persisting; upsert by (id,key).
     * Unlock-gated. The key is plaintext; the value is an opaque ciphertext blob.
     */
    async set_metadata(input: {
      vault_id: string;
      credential_id: string;
      key: string;
      value: Uint8Array;
    }): Promise<{ entry: { credential_id: string; key: string } }> {
      const masterKey = requireKey(input.vault_id);
      const value_handle = await encryptField(masterKey, input.value);
      const entry: CredentialMetadataEntry = {
        credential_id: input.credential_id,
        key: input.key,
        value_handle,
      };
      await metas.put(metaId(input.credential_id, input.key), entry);
      return { entry: { credential_id: input.credential_id, key: input.key } };
    },

    /**
     * get_metadata - decrypt and return the per-credential metadata VALUES.
     * Unlock-gated (as sensitive as retrieve): locked → E_VAULT_LOCKED.
     */
    async get_metadata(input: {
      vault_id: string;
      credential_id: string;
    }): Promise<{ entries: Array<{ key: string; value: Uint8Array }> }> {
      const masterKey = requireKey(input.vault_id);
      const all = (await metas.query()).filter((e) => e.credential_id === input.credential_id);
      const entries: Array<{ key: string; value: Uint8Array }> = [];
      for (const e of all) {
        entries.push({ key: e.key, value: await decryptField(masterKey, e.value_handle) });
      }
      entries.sort((a, b) => a.key.localeCompare(b.key));
      return { entries };
    },

    /** delete_metadata - remove a single (credential_id,key) entry. */
    async delete_metadata(input: {
      vault_id: string;
      credential_id: string;
      key: string;
    }): Promise<{ deleted: boolean }> {
      const id = metaId(input.credential_id, input.key);
      const existing = await metas.get(id);
      if (!existing) return { deleted: false };
      await metas.delete(id);
      return { deleted: true };
    },

    /** record_sync - write per-credential sync bookkeeping (non-secret). Not gated. */
    async record_sync(input: {
      vault_id: string;
      credential_id: string;
      sync_hash: string;
    }): Promise<{ sync: SyncStateNode }> {
      const node: SyncStateNode = {
        credential_id: input.credential_id,
        last_sync: new Date().toISOString(),
        sync_hash: input.sync_hash,
      };
      await syncs.put(input.credential_id, node);
      return { sync: node };
    },

    // -- deferred ops - honest E_NOT_IMPLEMENTED, NEVER a fake success --------

    /**
     * rotate - DEFERRED (C-NOSTUB-001). No first-class vault-core rotate method
     * exists; secret change-in-place is done via `update` (re-encrypt + bump
     * rotated). A first-class rotate (old-secret retention, rotation policy,
     * atomic re-encrypt-under-new-DEK) is post-v1. This returns an HONEST
     * E_NOT_IMPLEMENTED result and performs NO write — it never fakes success.
     */
    async rotate(_input: unknown): Promise<DeferredResult> {
      return {
        deferred: true,
        code: 'E_NOT_IMPLEMENTED',
        reason:
          'rotate is deferred: no first-class vault-core rotate exists. Use update() ' +
          'for secret change-in-place. First-class rotation is post-v1 (vault-crypto port).',
      };
    },

    /**
     * link - DEFERRED (C-NOSTUB-001). vault-graph SecretGraph::add_edge exists
     * but is an in-memory graph not yet persisted/exposed via VaultManager. This
     * returns an HONEST E_NOT_IMPLEMENTED result and performs NO write.
     */
    async link(_input: unknown): Promise<DeferredResult> {
      return {
        deferred: true,
        code: 'E_NOT_IMPLEMENTED',
        reason:
          'link is deferred: vault-graph relationship edges are in-memory only and ' +
          'not yet persisted/exposed via VaultManager. Post-v1 (vault-graph port).',
      };
    },
  };
}
