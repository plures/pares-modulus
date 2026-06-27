/**
 * secrets-provider — C-TEST-002 security + behavior proof.
 *
 * Exercises the REAL provider (real AES-256-GCM + PBKDF2 WebCrypto) over an
 * in-memory PluresDBGraph storage seam. These tests are the conformance
 * evidence for the `secrets` CID invariants — each invariant has at least one
 * test that PROVES it (cited in the it(...) titles).
 *
 * No mock crypto, no plaintext shortcut, in-memory graph ONLY (storage seam).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestContext, type TestContext } from './test-context.js';
import { createSecretsProvider, SecretsError, type SecretsProvider } from './provider.js';
import { utf8, fromUtf8 } from './crypto.js';

const VAULT = 'v-main';
const PASS = utf8('correct horse battery staple');
const WRONG = utf8('Tr0ub4dor&3');
// Distinctive plaintexts we can grep for in the raw persisted bytes.
const SECRET_PLAINTEXT = 'hunter2-SUPER-SECRET-VALUE-7f3a91';
const NOTES_PLAINTEXT = 'recovery-codes-DO-NOT-LEAK-4b2c';

let t: TestContext;
let p: SecretsProvider;

async function unlockFresh(): Promise<void> {
  await p.unlock({ vault_id: VAULT, passphrase: PASS, vault_name: 'Main' });
}

const CRED = 'pluresdb:plugin:secrets-provider/credential_meta/';
const METAK = 'pluresdb:plugin:secrets-provider/credential_metadata_entry/';
const SYNC = 'pluresdb:plugin:secrets-provider/sync_state/';
const VAULTK = 'pluresdb:plugin:secrets-provider/vault_state/';

beforeEach(() => {
  t = makeTestContext();
  p = createSecretsProvider(t.ctx);
});

// ─── lifecycle ──────────────────────────────────────────────────────────────

describe('lifecycle', () => {
  it('unlock initializes a fresh vault and reports unlocked', async () => {
    const res = await p.unlock({ vault_id: VAULT, passphrase: PASS, vault_name: 'Main' });
    expect(res.unlocked).toBe(true);
    expect(res.vault.vault_id).toBe(VAULT);
    expect(res.vault.kdf_algorithm).toBe('pbkdf2-hmac-sha256');
    expect(res.vault.kdf_iterations).toBeGreaterThanOrEqual(210_000);
    expect(await p.is_unlocked({ vault_id: VAULT })).toEqual({ unlocked: true });
  });

  it('lock() drops the master key (master_key_only_while_unlocked)', async () => {
    await unlockFresh();
    expect(await p.is_unlocked({ vault_id: VAULT })).toEqual({ unlocked: true });
    expect(await p.lock({ vault_id: VAULT })).toEqual({ unlocked: false });
    expect(await p.is_unlocked({ vault_id: VAULT })).toEqual({ unlocked: false });
  });

  it('re-unlock with the correct passphrase succeeds across a lock cycle', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'gh', secret: utf8(SECRET_PLAINTEXT) });
    await p.lock({ vault_id: VAULT });
    expect((await p.unlock({ vault_id: VAULT, passphrase: PASS })).unlocked).toBe(true);
    expect(fromUtf8((await p.retrieve({ vault_id: VAULT, title: 'gh' })).secret)).toBe(
      SECRET_PLAINTEXT,
    );
  });
});

// ─── round-trip + metadata projection ───────────────────────────────────────

describe('store -> list_metadata -> retrieve round-trip', () => {
  it('round-trips secret+notes; list_metadata carries NO plaintext', async () => {
    await unlockFresh();
    const stored = await p.store({
      vault_id: VAULT,
      title: 'github',
      username: 'kayodebristol',
      url: 'https://github.com',
      secret: utf8(SECRET_PLAINTEXT),
      notes: utf8(NOTES_PLAINTEXT),
    });
    expect(stored.credential).not.toHaveProperty('ciphertext_handle');
    expect(stored.credential).not.toHaveProperty('notes_handle');
    expect(stored.credential.has_notes).toBe(true);
    expect(stored.credential.title).toBe('github');

    const list = await p.list_metadata({ vault_id: VAULT });
    expect(list.credentials).toHaveLength(1);
    const meta = list.credentials[0];
    expect(meta).not.toHaveProperty('ciphertext_handle');
    expect(meta).not.toHaveProperty('notes_handle');
    const listJson = JSON.stringify(list);
    expect(listJson).not.toContain(SECRET_PLAINTEXT);
    expect(listJson).not.toContain(NOTES_PLAINTEXT);
    expect(meta.username).toBe('kayodebristol');

    const got = await p.retrieve({ vault_id: VAULT, title: 'github' });
    expect(fromUtf8(got.secret)).toBe(SECRET_PLAINTEXT);
    expect(got.notes && fromUtf8(got.notes)).toBe(NOTES_PLAINTEXT);
  });

  it('retrieve by id also works', async () => {
    await unlockFresh();
    const { credential } = await p.store({
      vault_id: VAULT,
      title: 'svc',
      secret: utf8(SECRET_PLAINTEXT),
    });
    expect(fromUtf8((await p.retrieve({ vault_id: VAULT, id: credential.id })).secret)).toBe(
      SECRET_PLAINTEXT,
    );
  });

  it('duplicate title -> E_ALREADY_EXISTS', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'dup', secret: utf8('a') });
    await expect(
      p.store({ vault_id: VAULT, title: 'dup', secret: utf8('b') }),
    ).rejects.toMatchObject({ code: 'E_ALREADY_EXISTS' });
  });

  it('retrieve missing -> E_NOT_FOUND', async () => {
    await unlockFresh();
    await expect(p.retrieve({ vault_id: VAULT, title: 'nope' })).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
  });
});

// ─── SECURITY: encrypted-at-rest / never-in-node-body ───────────────────────

describe('SECURITY: secrets_encrypted_at_rest + secrets_never_in_node_body', () => {
  it('raw persisted node bytes contain NO plaintext secret or notes', async () => {
    await unlockFresh();
    await p.store({
      vault_id: VAULT,
      title: 'github',
      secret: utf8(SECRET_PLAINTEXT),
      notes: utf8(NOTES_PLAINTEXT),
    });

    const allRaw = t.graph.allRaw();
    expect(allRaw).not.toContain(SECRET_PLAINTEXT);
    expect(allRaw).not.toContain(NOTES_PLAINTEXT);

    const credKey = t.graph.keys(CRED).find(Boolean)!;
    const raw = t.graph.rawBytes(credKey);
    expect(raw).not.toContain(SECRET_PLAINTEXT);
    expect(raw).not.toContain(NOTES_PLAINTEXT);
    expect(raw).toContain('ciphertext_handle');
    expect(raw).toContain('"iv"');
    expect(raw).toContain('"ct"');
  });

  it('vault_state persists NO key/passphrase/plaintext (only public KDF data)', async () => {
    await unlockFresh();
    const raw = t.graph.rawBytes(t.graph.keys(VAULTK).find(Boolean)!);
    expect(raw).not.toContain('correct horse battery staple');
    expect(raw).toContain('salt');
    expect(raw).toContain('verifier');
    expect(raw).toContain('"iv"');
  });

  it('set_metadata value is encrypted at rest (no plaintext in the entry node)', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'm', secret: utf8('x') });
    const META_VALUE = '2fa-seed-JBSWY3DPEHPK3PXP';
    await p.set_metadata({
      vault_id: VAULT,
      credential_id: credential.id,
      key: '2fa_seed',
      value: utf8(META_VALUE),
    });
    expect(t.graph.allRaw()).not.toContain(META_VALUE);
    const raw = t.graph.rawBytes(t.graph.keys(METAK).find(Boolean)!);
    expect(raw).toContain('2fa_seed');
    expect(raw).toContain('value_handle');
    expect(raw).not.toContain(META_VALUE);
  });
});

// ─── SECURITY: retrieve_is_unlock_gated ─────────────────────────────────────

describe('SECURITY: retrieve_is_unlock_gated', () => {
  it('locked retrieve -> E_VAULT_LOCKED and returns NO plaintext', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'gh', secret: utf8(SECRET_PLAINTEXT) });
    await p.lock({ vault_id: VAULT });

    let threw: unknown;
    try {
      await p.retrieve({ vault_id: VAULT, title: 'gh' });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(SecretsError);
    expect((threw as SecretsError).code).toBe('E_VAULT_LOCKED');
    expect(String(threw)).not.toContain(SECRET_PLAINTEXT);
  });

  it('lock() then retrieve fails even though the credential still exists at rest', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'gh', secret: utf8(SECRET_PLAINTEXT) });
    await p.lock({ vault_id: VAULT });
    expect(t.graph.keys(CRED).length).toBe(1);
    await expect(p.retrieve({ vault_id: VAULT, title: 'gh' })).rejects.toMatchObject({
      code: 'E_VAULT_LOCKED',
    });
  });

  it('locked get_metadata -> E_VAULT_LOCKED (also unlock-gated)', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'm', secret: utf8('x') });
    await p.set_metadata({ vault_id: VAULT, credential_id: credential.id, key: 'k', value: utf8('v') });
    await p.lock({ vault_id: VAULT });
    await expect(
      p.get_metadata({ vault_id: VAULT, credential_id: credential.id }),
    ).rejects.toMatchObject({ code: 'E_VAULT_LOCKED' });
  });

  it('locked store/update/list_metadata/set_metadata are all gated -> E_VAULT_LOCKED', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'gh', secret: utf8('s') });
    await p.lock({ vault_id: VAULT });
    await expect(p.store({ vault_id: VAULT, title: 'new', secret: utf8('s') })).rejects.toMatchObject({
      code: 'E_VAULT_LOCKED',
    });
    await expect(p.update({ vault_id: VAULT, title: 'gh', secret: utf8('s2') })).rejects.toMatchObject({
      code: 'E_VAULT_LOCKED',
    });
    await expect(p.list_metadata({ vault_id: VAULT })).rejects.toMatchObject({
      code: 'E_VAULT_LOCKED',
    });
    await expect(
      p.set_metadata({ vault_id: VAULT, credential_id: credential.id, key: 'k', value: utf8('v') }),
    ).rejects.toMatchObject({ code: 'E_VAULT_LOCKED' });
  });
});

// ─── SECURITY: wrong_passphrase_reveals_nothing ─────────────────────────────

describe('SECURITY: wrong_passphrase_reveals_nothing', () => {
  it('wrong passphrase -> E_INVALID_PASSPHRASE and grants no access', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'gh', secret: utf8(SECRET_PLAINTEXT) });
    await p.lock({ vault_id: VAULT });

    await expect(p.unlock({ vault_id: VAULT, passphrase: WRONG })).rejects.toMatchObject({
      code: 'E_INVALID_PASSPHRASE',
    });
    expect(await p.is_unlocked({ vault_id: VAULT })).toEqual({ unlocked: false });
    await expect(p.retrieve({ vault_id: VAULT, title: 'gh' })).rejects.toMatchObject({
      code: 'E_VAULT_LOCKED',
    });
  });

  it('a fresh provider over persisted state still rejects the wrong passphrase', async () => {
    await unlockFresh();
    await p.store({ vault_id: VAULT, title: 'gh', secret: utf8(SECRET_PLAINTEXT) });

    const p2 = createSecretsProvider(t.ctx);
    await expect(p2.unlock({ vault_id: VAULT, passphrase: WRONG })).rejects.toMatchObject({
      code: 'E_INVALID_PASSPHRASE',
    });
    await p2.unlock({ vault_id: VAULT, passphrase: PASS });
    expect(fromUtf8((await p2.retrieve({ vault_id: VAULT, title: 'gh' })).secret)).toBe(
      SECRET_PLAINTEXT,
    );
  });
});

// ─── metadata entries: set / get / delete ───────────────────────────────────

describe('credential metadata entries', () => {
  it('set -> get round-trips the decrypted value; upsert + delete work', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'm', secret: utf8('x') });
    const cid = credential.id;

    await p.set_metadata({ vault_id: VAULT, credential_id: cid, key: 'k1', value: utf8('v1') });
    await p.set_metadata({ vault_id: VAULT, credential_id: cid, key: 'k2', value: utf8('v2') });

    const got = await p.get_metadata({ vault_id: VAULT, credential_id: cid });
    expect(got.entries.map((e) => [e.key, fromUtf8(e.value)])).toEqual([
      ['k1', 'v1'],
      ['k2', 'v2'],
    ]);

    await p.set_metadata({ vault_id: VAULT, credential_id: cid, key: 'k1', value: utf8('v1b') });
    const got2 = await p.get_metadata({ vault_id: VAULT, credential_id: cid });
    expect(fromUtf8(got2.entries.find((e) => e.key === 'k1')!.value)).toBe('v1b');

    expect(await p.delete_metadata({ vault_id: VAULT, credential_id: cid, key: 'k1' })).toEqual({
      deleted: true,
    });
    expect(await p.delete_metadata({ vault_id: VAULT, credential_id: cid, key: 'nope' })).toEqual({
      deleted: false,
    });
    const got3 = await p.get_metadata({ vault_id: VAULT, credential_id: cid });
    expect(got3.entries.map((e) => e.key)).toEqual(['k2']);
  });
});

// ─── update (re-encrypt) ────────────────────────────────────────────────────

describe('update re-encrypts the secret in place', () => {
  it('changes the plaintext and the ciphertext, bumps rotated', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'gh', secret: utf8('old-secret') });
    const credKey = t.graph.keys(CRED).find(Boolean)!;
    const beforeRaw = t.graph.rawBytes(credKey);

    const upd = await p.update({ vault_id: VAULT, id: credential.id, secret: utf8('new-secret') });
    expect(upd.credential.id).toBe(credential.id);
    expect(fromUtf8((await p.retrieve({ vault_id: VAULT, id: credential.id })).secret)).toBe(
      'new-secret',
    );

    const afterRaw = t.graph.rawBytes(credKey);
    expect(afterRaw).not.toEqual(beforeRaw);
    expect(afterRaw).not.toContain('new-secret');
    expect(afterRaw).not.toContain('old-secret');
    expect(upd.credential.rotated >= credential.rotated).toBe(true);
  });

  it('rename via new_title works', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'old', secret: utf8('s') });
    await p.update({ vault_id: VAULT, id: credential.id, new_title: 'renamed' });
    expect((await p.list_metadata({ vault_id: VAULT })).credentials[0].title).toBe('renamed');
  });

  it('update of a missing credential -> E_NOT_FOUND', async () => {
    await unlockFresh();
    await expect(
      p.update({ vault_id: VAULT, id: 'does-not-exist', secret: utf8('s') }),
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

// ─── delete cascades ────────────────────────────────────────────────────────

describe('delete cascades metadata + sync (delete_cascades)', () => {
  it('removes the credential, its metadata entries, and its sync node', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'gh', secret: utf8('s') });
    const cid = credential.id;
    await p.set_metadata({ vault_id: VAULT, credential_id: cid, key: 'k', value: utf8('v') });
    await p.record_sync({ vault_id: VAULT, credential_id: cid, sync_hash: 'abc123' });

    expect(t.graph.keys(CRED).length).toBe(1);
    expect(t.graph.keys(METAK).length).toBe(1);
    expect(t.graph.keys(SYNC).length).toBe(1);

    expect(await p.delete({ vault_id: VAULT, id: cid })).toEqual({ deleted: true });

    expect(t.graph.keys(CRED).length).toBe(0);
    expect(t.graph.keys(METAK).length).toBe(0);
    expect(t.graph.keys(SYNC).length).toBe(0);
  });

  it('deleting a missing credential -> { deleted: false }', async () => {
    await unlockFresh();
    expect(await p.delete({ vault_id: VAULT, id: 'nope' })).toEqual({ deleted: false });
  });
});

// ─── record_sync ────────────────────────────────────────────────────────────

describe('record_sync', () => {
  it('writes a non-secret sync node with the content hash', async () => {
    await unlockFresh();
    const { credential } = await p.store({ vault_id: VAULT, title: 'gh', secret: utf8('s') });
    const res = await p.record_sync({
      vault_id: VAULT,
      credential_id: credential.id,
      sync_hash: 'deadbeef',
    });
    expect(res.sync.credential_id).toBe(credential.id);
    expect(res.sync.sync_hash).toBe('deadbeef');
    expect(typeof res.sync.last_sync).toBe('string');
  });
});

// ─── DEFERRED ops are HONEST (never a fake success) ─────────────────────────

describe('deferred ops return E_NOT_IMPLEMENTED (C-NOSTUB-001)', () => {
  it('rotate -> E_NOT_IMPLEMENTED, not a fake ok, and writes nothing', async () => {
    await unlockFresh();
    const before = t.graph.store.size;
    const res = await p.rotate({ vault_id: VAULT, id: 'whatever' });
    expect(res.deferred).toBe(true);
    expect(res.code).toBe('E_NOT_IMPLEMENTED');
    expect(res).not.toHaveProperty('ok');
    expect(t.graph.store.size).toBe(before); // no persistence side effect
  });

  it('link -> E_NOT_IMPLEMENTED, not a fake ok, and writes nothing', async () => {
    await unlockFresh();
    const before = t.graph.store.size;
    const res = await p.link({ vault_id: VAULT, source_id: 'a', target_id: 'b' });
    expect(res.deferred).toBe(true);
    expect(res.code).toBe('E_NOT_IMPLEMENTED');
    expect(t.graph.store.size).toBe(before);
  });
});
