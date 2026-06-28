/**
 * scene-provider conformance tests (C-TEST-002) — exercise the REAL provider
 * against a real PluginContext backed by an in-memory graph (storage seam only;
 * the projection + intent-validation logic under test is the REAL logic, never
 * mocked). vitest `globals:false`, so describe/it/expect are imported.
 *
 * Coverage maps directly to the scene CID invariants + operations:
 *   - project()          : well-formed RSV (contract_version '1.0.0', tier);
 *                          unknown tier -> E_UNKNOWN_TIER; every projected entity
 *                          carries transform.position (rsv_position_required) AND
 *                          convergence.staleness (rsv_staleness_required).
 *   - deriveConvergence(): honest fog — staleness 0 -> confidence 1.0;
 *                          staleness 5 -> 0; staleness 10 -> 0 (clamped, never
 *                          negative); staleness always >= 0; E_NOT_FOUND on miss.
 *   - projectEntity()    : one entity, or E_NOT_FOUND.
 *   - frontier()         : latestHlc across source nodes.
 *   - submitIntent()     : unsigned -> E_UNSIGNED; cross-owner -> E_NOT_OWNER;
 *                          ScanContributionIntent from 'lite' -> E_SCAN_NOT_PREMIUM;
 *                          intent carrying a convergence field ->
 *                          E_INTENT_CARRIES_OBSERVATION; unknown type ->
 *                          E_UNKNOWN_INTENT; a valid signed owned MoveIntent ->
 *                          accepted:true (and persists a real intent node).
 *   - announceProfile()  : lite+wantsStaleness:false -> E_PROFILE_INVALID;
 *                          lite+canScan:true -> E_PROFILE_INVALID;
 *                          premium+canScan:true+wantsStaleness:true -> accepted;
 *                          ambient+wantsStaleness:false -> accepted.
 *   - simulateZone()     : DEFERRED -> honest E_NOT_IMPLEMENTED, NO write.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestContext, type TestContext } from './test-context.js';
import {
  createSceneProvider,
  SceneError,
  CONTRACT_VERSION,
  type SceneProvider,
  type RsvEntitySource,
} from './provider.js';

const NOW = 1_000_000; // a fixed observerNow (seconds) for deterministic staleness

/** Seed a scene:rsv_entity SOURCE node (keyed by entity_id) into ctx.data. */
async function seedEntity(
  tc: TestContext,
  partial: Partial<RsvEntitySource> & Pick<RsvEntitySource, 'entity_id'>,
): Promise<RsvEntitySource> {
  const node: RsvEntitySource = {
    entity_id: partial.entity_id,
    kind: partial.kind ?? 'player',
    owner_id: partial.owner_id ?? '',
    transform: partial.transform ?? { position: [0, 0, 0] },
    last_write_hlc_time: partial.last_write_hlc_time ?? NOW,
    hlc: partial.hlc ?? '0000',
    vitals: partial.vitals,
    presentation: partial.presentation,
    signature_verified: partial.signature_verified,
  };
  await tc.ctx.data.collection<RsvEntitySource>('rsv_entity').put(node.entity_id, node);
  return node;
}

describe('scene-provider :: scene@1.x conformance', () => {
  let tc: TestContext;
  let provider: SceneProvider;

  beforeEach(() => {
    tc = makeTestContext();
    provider = createSceneProvider(tc.ctx);
  });

  // ── project (buildRenderStateView) ────────────────────────────────────────

  it('project() returns a well-formed RSV (contract_version 1.0.0, correct tier)', async () => {
    await seedEntity(tc, {
      entity_id: 'player:alice',
      kind: 'player',
      owner_id: 'player:alice',
      transform: { position: [1, 2, 3] },
      last_write_hlc_time: NOW,
      hlc: '0005',
    });
    const rsv = await provider.project('standard', NOW, 'player:alice');
    expect(rsv.contract_version).toBe('1.0.0');
    expect(rsv.contract_version).toBe(CONTRACT_VERSION);
    expect(rsv.tier).toBe('standard');
    expect(Array.isArray(rsv.entities)).toBe(true);
    expect(rsv.entities.length).toBe(1);
    expect(rsv.entities[0].entity_id).toBe('player:alice');
    // as_of_hlc = latestHlc across source nodes.
    expect(rsv.as_of_hlc).toBe('0005');
  });

  it('project() with an unknown tier -> E_UNKNOWN_TIER', async () => {
    await expect(provider.project('ultra', NOW, 'obs')).rejects.toMatchObject({
      code: 'E_UNKNOWN_TIER',
    });
    await expect(provider.project('ultra', NOW, 'obs')).rejects.toBeInstanceOf(SceneError);
  });

  it('each valid tier projects (lite/standard/premium/ambient all accepted)', async () => {
    await seedEntity(tc, { entity_id: 'player:a', transform: { position: [0, 0] } });
    for (const tier of ['lite', 'standard', 'premium', 'ambient'] as const) {
      const rsv = await provider.project(tier, NOW, 'obs');
      expect(rsv.tier).toBe(tier);
    }
  });

  it('every projected entity carries position + staleness (rsv_position/staleness_required)', async () => {
    await seedEntity(tc, {
      entity_id: 'ship:beta',
      kind: 'ship',
      transform: { position: [10, 20] },
      last_write_hlc_time: NOW - 2,
      hlc: '0009',
    });
    await seedEntity(tc, {
      entity_id: 'structure:gamma',
      kind: 'structure',
      transform: { position: [5, 6, 7] },
      last_write_hlc_time: NOW - 1,
      hlc: '0007',
    });
    const rsv = await provider.project('premium', NOW, 'obs');
    expect(rsv.entities.length).toBe(2);
    for (const e of rsv.entities) {
      expect(Array.isArray(e.transform.position)).toBe(true);
      expect(e.transform.position.length).toBeGreaterThanOrEqual(2);
      expect(typeof e.convergence.staleness).toBe('number');
      expect(e.convergence.staleness).toBeGreaterThanOrEqual(0);
      expect(e.convergence.confidence).toBeGreaterThanOrEqual(0);
      expect(e.convergence.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('project() DROPS malformed source nodes (no half-formed entity; absence_is_not_hidden_truth)', async () => {
    await seedEntity(tc, { entity_id: 'player:good', transform: { position: [1, 1, 1] } });
    // Malformed: empty position array (violates rsv_position_required at the seam).
    await tc.ctx.data.collection<RsvEntitySource>('rsv_entity').put('player:bad', {
      entity_id: 'player:bad',
      kind: 'player',
      owner_id: '',
      transform: { position: [] },
      last_write_hlc_time: NOW,
      hlc: '0001',
    });
    const rsv = await provider.project('lite', NOW, 'obs');
    expect(rsv.entities.map((e) => e.entity_id)).toEqual(['player:good']);
  });

  // ── projectEntity (projectNode) ───────────────────────────────────────────

  it('projectEntity() returns one entity, or E_NOT_FOUND on miss', async () => {
    await seedEntity(tc, {
      entity_id: 'fauna:whale',
      kind: 'fauna',
      transform: { position: [3, 3, 3] },
      last_write_hlc_time: NOW,
    });
    const e = await provider.projectEntity('fauna:whale', 'standard', NOW);
    expect(e.entity_id).toBe('fauna:whale');
    expect(e.kind).toBe('fauna');
    expect(e.convergence.staleness).toBe(0);

    await expect(provider.projectEntity('fauna:ghost', 'standard', NOW)).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
  });

  // ── deriveConvergence (honest fog) ────────────────────────────────────────

  it('deriveConvergence: staleness 0 -> confidence 1.0', async () => {
    await seedEntity(tc, { entity_id: 'player:fresh', last_write_hlc_time: NOW });
    const c = await provider.deriveConvergence('player:fresh', NOW);
    expect(c.staleness).toBe(0);
    expect(c.confidence).toBe(1);
  });

  it('deriveConvergence: staleness 5 -> confidence 0 (at the horizon)', async () => {
    await seedEntity(tc, { entity_id: 'player:edge', last_write_hlc_time: NOW - 5 });
    const c = await provider.deriveConvergence('player:edge', NOW);
    expect(c.staleness).toBe(5);
    expect(c.confidence).toBe(0);
  });

  it('deriveConvergence: staleness 10 -> confidence 0, clamped (never negative)', async () => {
    await seedEntity(tc, { entity_id: 'player:old', last_write_hlc_time: NOW - 10 });
    const c = await provider.deriveConvergence('player:old', NOW);
    expect(c.staleness).toBe(10);
    expect(c.confidence).toBe(0);
    expect(c.confidence).toBeGreaterThanOrEqual(0); // honest_fog: never negative
  });

  it('deriveConvergence: staleness is never negative even if observerNow < lastWrite', async () => {
    // A clock-skewed observer in the past must still see staleness >= 0.
    await seedEntity(tc, { entity_id: 'player:future', last_write_hlc_time: NOW + 100 });
    const c = await provider.deriveConvergence('player:future', NOW);
    expect(c.staleness).toBeGreaterThanOrEqual(0);
    expect(c.staleness).toBe(0);
    expect(c.confidence).toBe(1);
  });

  it('deriveConvergence: confidence stays in [0,1] across the horizon (honest fog midpoint)', async () => {
    await seedEntity(tc, { entity_id: 'player:mid', last_write_hlc_time: NOW - 2.5 });
    const c = await provider.deriveConvergence('player:mid', NOW);
    expect(c.staleness).toBeCloseTo(2.5);
    expect(c.confidence).toBeCloseTo(0.5); // 1 - 2.5/5
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(1);
  });

  it('deriveConvergence: E_NOT_FOUND when no node exists', async () => {
    await expect(provider.deriveConvergence('player:nobody', NOW)).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    });
  });

  // ── frontier (latestHlc) ──────────────────────────────────────────────────

  it('frontier() returns the latest HLC across all source nodes', async () => {
    await seedEntity(tc, { entity_id: 'player:a', hlc: '0003' });
    await seedEntity(tc, { entity_id: 'player:b', hlc: '0042' });
    await seedEntity(tc, { entity_id: 'player:c', hlc: '0011' });
    const f = await provider.frontier();
    expect(f.as_of_hlc).toBe('0042');
  });

  // ── submitIntent (the signed, ownership-bounded write path) ───────────────

  it('submitIntent: unsigned intent -> E_UNSIGNED (intent_must_be_signed)', async () => {
    await seedEntity(tc, { entity_id: 'player:alice', owner_id: 'player:alice' });
    const res = await provider.submitIntent(
      {
        intent_type: 'MoveIntent',
        owner_id: 'player:alice',
        entity_id: 'player:alice',
        hlc: '0010',
        signature: '', // missing/empty
        payload: { to: [1, 2, 3] },
      },
      'standard',
    );
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_UNSIGNED');
  });

  it('submitIntent: an intent carrying a convergence field -> E_INTENT_CARRIES_OBSERVATION', async () => {
    await seedEntity(tc, { entity_id: 'player:alice', owner_id: 'player:alice' });
    const res = await provider.submitIntent(
      {
        intent_type: 'MoveIntent',
        owner_id: 'player:alice',
        entity_id: 'player:alice',
        hlc: '0011',
        signature: 'sig-abc',
        // ILLEGAL: convergence is an OBSERVATION, never authored on an intent.
        payload: { to: [1, 2, 3], convergence: { staleness: 0, confidence: 1 } },
      },
      'standard',
    );
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_INTENT_CARRIES_OBSERVATION');
  });

  it('submitIntent: ScanContributionIntent from a non-premium tier -> E_SCAN_NOT_PREMIUM', async () => {
    await seedEntity(tc, { entity_id: 'zone:reef', owner_id: 'player:alice', kind: 'zone' });
    const res = await provider.submitIntent(
      {
        intent_type: 'ScanContributionIntent',
        owner_id: 'player:alice',
        entity_id: 'zone:reef',
        hlc: '0012',
        signature: 'sig-scan',
        payload: { mesh: 'blob' },
      },
      'lite', // non-premium
    );
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_SCAN_NOT_PREMIUM');
  });

  it('submitIntent: unknown intent type -> E_UNKNOWN_INTENT', async () => {
    await seedEntity(tc, { entity_id: 'player:alice', owner_id: 'player:alice' });
    const res = await provider.submitIntent(
      {
        intent_type: 'TeleportIntent', // not one of the 6
        owner_id: 'player:alice',
        entity_id: 'player:alice',
        hlc: '0013',
        signature: 'sig-x',
        payload: {},
      },
      'standard',
    );
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_UNKNOWN_INTENT');
  });

  it('submitIntent: cross-owner write (owner_id != entity.owner_id) -> E_NOT_OWNER', async () => {
    // Entity owned by alice; bob tries to move it.
    await seedEntity(tc, { entity_id: 'player:alice', owner_id: 'player:alice' });
    const res = await provider.submitIntent(
      {
        intent_type: 'MoveIntent',
        owner_id: 'player:bob', // not the owner
        entity_id: 'player:alice',
        hlc: '0014',
        signature: 'sig-bob',
        payload: { to: [9, 9, 9] },
      },
      'standard',
    );
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_NOT_OWNER');
  });

  it('submitIntent: a valid signed owned MoveIntent -> accepted:true (and persists a real node)', async () => {
    await seedEntity(tc, {
      entity_id: 'player:alice',
      owner_id: 'player:alice',
      transform: { position: [0, 0, 0] },
      last_write_hlc_time: NOW,
      hlc: '0001',
    });
    const res = await provider.submitIntent(
      {
        intent_type: 'MoveIntent',
        owner_id: 'player:alice',
        entity_id: 'player:alice',
        hlc: '0015',
        signature: 'sig-good',
        payload: { to: [1, 0, 0] },
      },
      'standard',
    );
    expect(res.accepted).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.entity?.entity_id).toBe('player:alice');

    // It persisted a REAL intent node in the data collection (C-PLURES-003/004).
    const intentKeys = tc.graph.keys('pluresdb:plugin:scene-provider/intent/');
    expect(intentKeys.length).toBe(1);
  });

  it('submitIntent: rejected writes persist NO intent node (a rejected write cannot converge)', async () => {
    await seedEntity(tc, { entity_id: 'player:alice', owner_id: 'player:alice' });
    await provider.submitIntent(
      { intent_type: 'MoveIntent', owner_id: 'player:alice', entity_id: 'player:alice', signature: '' },
      'standard',
    );
    expect(tc.graph.keys('pluresdb:plugin:scene-provider/intent/').length).toBe(0);
  });

  // ── announceProfile (capability negotiation) ──────────────────────────────

  it('announceProfile: lite + wantsStaleness:false -> E_PROFILE_INVALID', async () => {
    const res = await provider.announceProfile({
      tier: 'lite',
      spatial: '2d',
      wants_staleness: false,
      max_entities: 50,
      can_scan: false,
    });
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_PROFILE_INVALID');
  });

  it('announceProfile: lite + canScan:true -> E_PROFILE_INVALID (non_premium_cannot_scan)', async () => {
    const res = await provider.announceProfile({
      tier: 'lite',
      spatial: '2d',
      wants_staleness: true, // staleness ok, but scan is not
      max_entities: 50,
      can_scan: true,
    });
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_PROFILE_INVALID');
  });

  it('announceProfile: premium + canScan:true + wantsStaleness:true -> accepted', async () => {
    const res = await provider.announceProfile({
      tier: 'premium',
      spatial: 'mesh',
      wants_staleness: true,
      max_entities: 500,
      can_scan: true,
    });
    expect(res.accepted).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('announceProfile: ambient + wantsStaleness:false -> accepted (ambient may omit staleness)', async () => {
    const res = await provider.announceProfile({
      tier: 'ambient',
      spatial: 'text',
      wants_staleness: false,
      max_entities: 10,
      can_scan: false,
    });
    expect(res.accepted).toBe(true);
    expect(res.error).toBeUndefined();
  });

  it('announceProfile: an unknown tier -> E_PROFILE_INVALID', async () => {
    const res = await provider.announceProfile({
      tier: 'ultra',
      wants_staleness: true,
      can_scan: false,
    });
    expect(res.accepted).toBe(false);
    expect(res.error).toBe('E_PROFILE_INVALID');
  });

  // ── deferred surface (C-NOSTUB-001) ───────────────────────────────────────

  it('simulateZone() returns honest E_NOT_IMPLEMENTED and performs NO write (never fake success)', async () => {
    const before = tc.graph.allRaw();
    const res = await provider.simulateZone({ zone_id: 'zone:reef' });
    expect(res).toMatchObject({ deferred: true, code: 'E_NOT_IMPLEMENTED' });
    expect(typeof res.reason).toBe('string');
    expect(res.reason.length).toBeGreaterThan(0);
    // It is NOT a fake success and wrote nothing.
    expect(tc.graph.allRaw()).toBe(before);
  });

  // ── SceneError shape ──────────────────────────────────────────────────────

  it('SceneError carries a stable, typed code', () => {
    const e = new SceneError('E_UNKNOWN_TIER', 'bad tier');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('E_UNKNOWN_TIER');
    expect(e.message).toContain('E_UNKNOWN_TIER');
  });
});
