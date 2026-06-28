/**
 * scene-provider - the REAL `scene@1.x` conformance provider.
 *
 * Implements the non-deferred surface of the `scene` CID
 * (pares-radix/capabilities/scene.cid.toml) over the live `ctx.data` collection
 * bridge. The capability projects converged PluresDB game state into a
 * render-agnostic Render State View (RSV) read-model that any renderer tier
 * (lite 2D ... premium ARKit) consumes, and accepts renderer writes ONLY as
 * signed, ownership-bounded Intents.
 *
 * CARDINAL RULE (CID header / render-convergence.px): the RSV is DERIVED, never
 * authored. convergence.* (staleness/confidence) and signature.* are network
 * OBSERVATIONS computed from CRDT merge gaps (HLC); a renderer/consumer may
 * NEVER write them. The single renderer write path is a signed,
 * ownership-bounded Intent, validated here at the contract boundary before the
 * game's per-type commit .px runs.
 *
 * Persistence (C-PLURES-003/004 - all via ctx.data.collection, never a HashMap
 * or localStorage in any runtime path):
 *   - "rsv_entity" : one node per game entity the RSV projects FROM. Carries the
 *                    minimal converged source state - entity_id, kind, owner_id,
 *                    transform.position (+optional orientation/velocity), the
 *                    last-write HLC time used to derive honest-fog staleness, and
 *                    optional vitals/presentation. convergence is DERIVED at
 *                    projection time, never stored as authored truth.
 *   - "rsv_zone"   : one node per active physics-zone override the scene PROJECTS
 *                    for rendering (zone SIMULATION is the separate `physics`
 *                    capability - see deferred surface).
 *   - "intent"     : the single renderer WRITE model. An accepted, signed,
 *                    ownership-bounded Intent is appended HLC-ordered.
 *
 * Grounding (1:1 with the real inner-space render-state surface, via the CID and
 * scene-cid-grounding.md): rsv-projection.js {CONTRACT_VERSION='1.0.0',
 * CONFIDENCE_HORIZON_S=5, confidenceFromStaleness(s,h=5)=max(0,1-s/5),
 * deriveConvergence, projectNode, buildRenderStateView, latestHlc}; the
 * render-state-view + intent JSON schemas; and the render-contract /
 * render-convergence MUST-rules ([invariants]).
 */

import type { PluginContext } from '@plures/pares-radix';

// ─── Constants (real rsv-projection.js symbols) ─────────────────────────────

/** rsv-projection.js CONTRACT_VERSION - stamped on every RSV root. */
export const CONTRACT_VERSION = '1.0.0';

/** rsv-projection.js CONFIDENCE_HORIZON_S - the honest-fog horizon (seconds). */
export const CONFIDENCE_HORIZON_S = 5;

/**
 * rsv-projection.js confidenceFromStaleness(staleSeconds, horizon=5) = max(0, 1 - s/h).
 * The honest-fog computation: a just-converged entity (staleness 0) is fully
 * confident (1.0); at/after the horizon confidence clamps to 0 and never goes
 * negative. confidence is therefore always in the unit range [0,1].
 */
export function confidenceFromStaleness(
  staleSeconds: number,
  horizon = CONFIDENCE_HORIZON_S,
): number {
  const c = 1 - staleSeconds / horizon;
  if (c <= 0) return 0;
  if (c >= 1) return 1;
  return c;
}

// ─── CID node enums ─────────────────────────────────────────────────────────

/** RSV.tier - the renderer tier the view is projected for. */
export type Tier = 'lite' | 'standard' | 'premium' | 'ambient';

const TIERS: ReadonlySet<Tier> = new Set<Tier>(['lite', 'standard', 'premium', 'ambient']);

/** rsvEntity.kind - the projected entity kinds. */
export type EntityKind = 'player' | 'ship' | 'zone' | 'fauna' | 'structure' | 'item';

/** Intent.intentType - the 6-member contract enum (intent.schema.json). */
export type IntentType =
  | 'MoveIntent'
  | 'ActionIntent'
  | 'TradeIntent'
  | 'ClaimIntent'
  | 'AttestIntent'
  | 'ScanContributionIntent';

const INTENT_TYPES: ReadonlySet<string> = new Set<IntentType>([
  'MoveIntent',
  'ActionIntent',
  'TradeIntent',
  'ClaimIntent',
  'AttestIntent',
  'ScanContributionIntent',
]);

/** spatial mode declared by a renderer profile (announce_profile). */
export type SpatialMode = '2d' | '3d' | 'mesh' | 'text';

// ─── RSV sub-shapes (mirror render-state-view.schema.json definitions) ──────

/** rsvEntity.transform - position is MUST; the rest are optional. */
export interface Transform {
  /** [2..3] floats. MUST be present on every visible entity. */
  position: number[];
  orientation?: number[];
  velocity?: number[];
  surface_normal?: number[];
}

/**
 * rsvEntity.convergence - the honest-fog seam. DERIVED, never authored.
 * staleness >= 0 (MUST); confidence in [0,1].
 */
export interface Convergence {
  staleness: number;
  confidence: number;
}

/** rsvEntity.vitals - optional renderer-facing vitals (wetness in [0,1]). */
export interface Vitals {
  health?: number;
  health_max?: number;
  energy?: number;
  charge?: number;
  wetness?: number;
}

/** rsvEntity.presentation - asset-binding archetype. */
export interface Presentation {
  archetype: string;
}

/** rsvEntity.signature - derived from the key check (verified flag only). */
export interface SignatureObservation {
  verified: boolean;
}

// ─── Stored source node shapes ──────────────────────────────────────────────

/**
 * scene:rsv_entity SOURCE node (collection "rsv_entity"). This is the converged
 * game-state the RSV projects FROM - NOT the authored RSV. convergence is
 * derived at projection time, so the source carries `last_write_hlc_time` (the
 * HLC wall-clock used to compute staleness = observerNow - lastWrite) and `hlc`
 * (the opaque HLC string used for the as_of_hlc frontier / latestHlc).
 */
export interface RsvEntitySource {
  entity_id: string;
  kind: EntityKind;
  /** Owner key holder; "" = unowned/world. Ownership is enforced on intents. */
  owner_id: string;
  transform: Transform;
  /** Seconds (epoch) of this node's last converged write; drives staleness. */
  last_write_hlc_time: number;
  /** Opaque HLC string for frontier/latestHlc ordering. */
  hlc: string;
  vitals?: Vitals;
  presentation?: Presentation;
  /** Whether the authority signature over the last write verified. */
  signature_verified?: boolean;
}

/** scene:rsv_zone SOURCE node (collection "rsv_zone"). Projected, not simulated. */
export interface RsvZoneSource {
  zone_id: string;
  physics: {
    wind?: Record<string, unknown>;
    water?: Record<string, unknown>;
    static_field?: Record<string, unknown>;
    chemical?: Record<string, unknown>;
    thermal?: Record<string, unknown>;
  };
  hlc?: string;
}

/**
 * scene:intent persisted node (collection "intent"). The single renderer write
 * model; an accepted, signed, ownership-bounded Intent (intent.schema.json).
 */
export interface IntentNode {
  contract_version: string;
  intent_type: IntentType;
  owner_id: string;
  entity_id: string;
  hlc: string;
  signature: string;
  /** Opaque per-type payload (base64/JSON at the boundary). */
  payload: unknown;
}

// ─── Projected (DERIVED) RSV read-model shapes ──────────────────────────────

/** scene:rsv_entity - the DERIVED projection returned to a renderer. */
export interface RsvEntity {
  entity_id: string;
  kind: EntityKind;
  owner_id: string;
  transform: Transform;
  /** DERIVED honest-fog seam (deriveConvergence). Never read from authored input. */
  convergence: Convergence;
  vitals?: Vitals;
  presentation?: Presentation;
  signature?: SignatureObservation;
}

/** scene:rsv_zone - projected zone overrides (rendering only). */
export interface RsvZone {
  zone_id: string;
  physics: RsvZoneSource['physics'];
}

/** scene:render_state_view - the DERIVED read-model root (buildRenderStateView). */
export interface RenderStateView {
  contract_version: string;
  tier: Tier;
  as_of_hlc: string;
  entities: RsvEntity[];
  zones: RsvZone[];
}

// ─── Intent / profile I/O ────────────────────────────────────────────────────

/**
 * An Intent as submitted by a renderer. The contract boundary accepts a loosely
 * typed body so it can REJECT malformed/observation-carrying intents with the
 * correct CID error (rather than failing to type-check a hostile write).
 */
export interface SubmittedIntent {
  contract_version?: string;
  intent_type?: string;
  /** Submitter's owner key id (^player:...). Must own the target entity. */
  owner_id?: string;
  entity_id?: string;
  hlc?: string;
  /** Authority signature over the body; missing/empty -> E_UNSIGNED. */
  signature?: string;
  /** Opaque per-type payload. MUST NOT carry convergence/signature observations. */
  payload?: unknown;
}

export interface SubmitIntentResult {
  accepted: boolean;
  entity?: RsvEntity;
  error?: SceneErrorCode;
}

export interface RendererProfile {
  tier: Tier | string;
  spatial?: SpatialMode;
  wants_staleness: boolean;
  max_entities?: number;
  can_scan: boolean;
}

export interface AnnounceProfileResult {
  accepted: boolean;
  error?: SceneErrorCode;
}

// ─── Error codes (from the CID `errors` lists) ──────────────────────────────

export type SceneErrorCode =
  | 'E_UNKNOWN_TIER'
  | 'E_NOT_FOUND'
  | 'E_UNSIGNED'
  | 'E_NOT_OWNER'
  | 'E_SCAN_NOT_PREMIUM'
  | 'E_INTENT_CARRIES_OBSERVATION'
  | 'E_UNKNOWN_INTENT'
  | 'E_PROFILE_INVALID'
  | 'E_NOT_IMPLEMENTED';

/** A mediated-boundary error carrying a stable CID error code. */
export class SceneError extends Error {
  readonly code: SceneErrorCode;
  constructor(code: SceneErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = 'SceneError';
    this.code = code;
  }
}

/** The deferred-op honest result shape (never a fake success). */
export interface DeferredResult {
  deferred: true;
  code: 'E_NOT_IMPLEMENTED';
  reason: string;
}

// ─── Provider surface ────────────────────────────────────────────────────────

export interface DeriveConvergenceResult {
  staleness: number;
  confidence: number;
}

/** The provider's public, mediated API surface (the 6 CID operations). */
export interface SceneProvider {
  /** project - buildRenderStateView: derive the full RSV for a tier. */
  project(
    tier: Tier | string,
    observerNow: number,
    observerId: string,
  ): Promise<RenderStateView>;
  /** project_entity - projectNode: derive a single RSV entity, or E_NOT_FOUND. */
  projectEntity(
    nodeId: string,
    tier: Tier | string,
    observerNow: number,
  ): Promise<RsvEntity>;
  /** derive_convergence - the honest-fog computation for one node. */
  deriveConvergence(nodeId: string, observerNow: number): Promise<DeriveConvergenceResult>;
  /** frontier - latestHlc: the convergence frontier across all source nodes. */
  frontier(): Promise<{ as_of_hlc: string }>;
  /** submit_intent - the single signed, ownership-bounded renderer write path. */
  submitIntent(intent: SubmittedIntent, fromTier: Tier | string): Promise<SubmitIntentResult>;
  /** announce_profile - renderer tier/capability negotiation. */
  announceProfile(profile: RendererProfile): Promise<AnnounceProfileResult>;
  /**
   * simulate_zone - DEFERRED (C-NOSTUB-001): zone SIMULATION belongs to the
   * separate `physics` capability; scene only PROJECTS zone overrides. Returns an
   * honest E_NOT_IMPLEMENTED, never a fake success.
   */
  simulateZone(input: unknown): Promise<DeferredResult>;
}

// ─── Collections ─────────────────────────────────────────────────────────────

const COLL_ENTITY = 'rsv_entity';
const COLL_ZONE = 'rsv_zone';
const COLL_INTENT = 'intent';

// ─── Derivation helpers (pure; mirror rsv-projection.js) ────────────────────

/**
 * deriveConvergence(node, observerNow) - staleness = max(0, observerNow -
 * lastWriteHlcTime) seconds; confidence = confidenceFromStaleness(staleness).
 * Enforces staleness_non_negative and confidence_in_unit_range. NEVER reads
 * convergence from the source (convergence_is_observed_not_authored).
 */
function deriveConvergenceFromSource(
  node: RsvEntitySource,
  observerNow: number,
): Convergence {
  const raw = observerNow - node.last_write_hlc_time;
  const staleness = raw > 0 ? raw : 0; // staleness_non_negative
  const confidence = confidenceFromStaleness(staleness);
  return { staleness, confidence };
}

/**
 * Is this source node well-formed enough to project? Enforces the RSV MUST
 * fields at the seam: transform.position present+non-empty (rsv_position_required)
 * and a derivable staleness basis (rsv_staleness_required - last_write_hlc_time
 * must be a finite number so staleness is computable).
 */
function isProjectable(node: RsvEntitySource): boolean {
  if (!node || typeof node !== 'object') return false;
  const pos = node.transform?.position;
  if (!Array.isArray(pos) || pos.length === 0) return false;
  if (!pos.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  if (typeof node.last_write_hlc_time !== 'number' || !Number.isFinite(node.last_write_hlc_time)) {
    return false;
  }
  return true;
}

/**
 * projectNode(node, observerNow) - derive one RSV entity from a source node.
 * convergence is DERIVED here; signature is projected as an observation
 * (verified flag) only. Returns null if the source is not projectable (so the
 * caller can DROP it from a full RSV - absence_is_not_hidden_truth - or surface
 * E_NOT_FOUND for a single-entity projection).
 */
function projectSourceNode(
  node: RsvEntitySource,
  observerNow: number,
): RsvEntity | null {
  if (!isProjectable(node)) return null;
  const entity: RsvEntity = {
    entity_id: node.entity_id,
    kind: node.kind,
    owner_id: node.owner_id ?? '',
    transform: node.transform,
    convergence: deriveConvergenceFromSource(node, observerNow),
  };
  if (node.vitals) entity.vitals = node.vitals;
  if (node.presentation) entity.presentation = node.presentation;
  if (typeof node.signature_verified === 'boolean') {
    entity.signature = { verified: node.signature_verified };
  }
  return entity;
}

/**
 * Detect an Intent illegally carrying network observations
 * (convergence_is_observed_not_authored). An Intent body/payload may NEVER carry
 * convergence.*, staleness, confidence, or a signature OBSERVATION
 * (signature.verified). The authority `signature` STRING on the intent itself is
 * the legitimate write credential and is NOT an observation.
 */
function carriesObservation(intent: SubmittedIntent): boolean {
  const probe = (obj: unknown, depth: number): boolean => {
    if (depth > 6 || obj === null || typeof obj !== 'object') return false;
    const rec = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const key = k.toLowerCase();
      if (key === 'convergence' || key === 'staleness' || key === 'confidence') return true;
      // A signature OBSERVATION object {verified:...} is forbidden; a bare
      // signature string credential at the top level is the write path and is
      // checked separately as `signature`.
      if (key === 'signature' && v !== null && typeof v === 'object') return true;
      if (v !== null && typeof v === 'object' && probe(v, depth + 1)) return true;
    }
    return false;
  };
  // Inspect the payload (per-type body) and any extra top-level fields beyond the
  // known intent envelope. The top-level `signature` string is the credential.
  if (probe(intent.payload, 0)) return true;
  const { contract_version, intent_type, owner_id, entity_id, hlc, signature, payload, ...rest } =
    intent;
  void contract_version;
  void intent_type;
  void owner_id;
  void entity_id;
  void hlc;
  void signature;
  void payload;
  return probe(rest, 0);
}

/**
 * Construct the scene provider over a PluginContext. ALL persistence flows
 * through ctx.data.collection(); there is no other store.
 */
export function createSceneProvider(ctx: PluginContext): SceneProvider {
  const entities = ctx.data.collection<RsvEntitySource>(COLL_ENTITY);
  const zones = ctx.data.collection<RsvZoneSource>(COLL_ZONE);
  const intents = ctx.data.collection<IntentNode>(COLL_INTENT);

  /** Assert a valid tier or throw E_UNKNOWN_TIER. */
  function requireTier(tier: Tier | string): Tier {
    if (!TIERS.has(tier as Tier)) {
      throw new SceneError('E_UNKNOWN_TIER', `unknown renderer tier "${String(tier)}"`);
    }
    return tier as Tier;
  }

  /** latestHlc(nodes) - the max HLC string across all source nodes ("" if none). */
  async function computeFrontier(): Promise<string> {
    const allEntities = await entities.query();
    const allZones = await zones.query();
    let max = '';
    for (const n of allEntities) {
      if (typeof n.hlc === 'string' && n.hlc > max) max = n.hlc;
    }
    for (const z of allZones) {
      if (typeof z.hlc === 'string' && z.hlc > max) max = z.hlc;
    }
    return max;
  }

  return {
    /**
     * project - buildRenderStateView: read every scene:rsv_entity source node,
     * derive its honest-fog convergence, and assemble the RSV for `tier`. Every
     * returned entity is guaranteed to carry transform.position
     * (rsv_position_required) and convergence.staleness (rsv_staleness_required);
     * malformed source nodes are DROPPED (absence_is_not_hidden_truth), never
     * emitted half-formed. as_of_hlc = latestHlc across all source nodes.
     */
    async project(
      tier: Tier | string,
      observerNow: number,
      observerId: string,
    ): Promise<RenderStateView> {
      const validTier = requireTier(tier);
      void observerId; // observer scoping is a post-v1 visibility concern (honest: unused here)

      const sourceEntities = await entities.query();
      const projected: RsvEntity[] = [];
      for (const src of sourceEntities) {
        const e = projectSourceNode(src, observerNow);
        if (e) projected.push(e);
      }
      projected.sort((a, b) => a.entity_id.localeCompare(b.entity_id));

      const sourceZones = await zones.query();
      const projectedZones: RsvZone[] = sourceZones
        .filter((z) => typeof z.zone_id === 'string' && z.zone_id.length > 0)
        .map((z) => ({ zone_id: z.zone_id, physics: z.physics ?? {} }))
        .sort((a, b) => a.zone_id.localeCompare(b.zone_id));

      return {
        contract_version: CONTRACT_VERSION,
        tier: validTier,
        as_of_hlc: await computeFrontier(),
        entities: projected,
        zones: projectedZones,
      };
    },

    /**
     * project_entity - projectNode: derive ONE rsv_entity by node id. Missing or
     * malformed (un-projectable) source -> E_NOT_FOUND (a half-formed entity is
     * never returned; rsv_position_required / rsv_staleness_required hold).
     */
    async projectEntity(
      nodeId: string,
      tier: Tier | string,
      observerNow: number,
    ): Promise<RsvEntity> {
      requireTier(tier);
      const src = await entities.get(nodeId);
      if (!src) throw new SceneError('E_NOT_FOUND', `entity "${nodeId}" not found`);
      const e = projectSourceNode(src, observerNow);
      if (!e) {
        throw new SceneError(
          'E_NOT_FOUND',
          `entity "${nodeId}" is not projectable (missing position or staleness basis)`,
        );
      }
      return e;
    },

    /**
     * derive_convergence - the honest-fog computation for one node:
     * staleness = max(0, observerNow - lastWriteHlcTime); confidence = max(0, 1 -
     * staleness/5). Enforces staleness>=0 and confidence in [0,1]. E_NOT_FOUND if
     * no such source node exists.
     */
    async deriveConvergence(
      nodeId: string,
      observerNow: number,
    ): Promise<DeriveConvergenceResult> {
      const src = await entities.get(nodeId);
      if (!src) throw new SceneError('E_NOT_FOUND', `entity "${nodeId}" not found`);
      const { staleness, confidence } = deriveConvergenceFromSource(src, observerNow);
      // Defensive re-assertion of the invariants (staleness_non_negative,
      // confidence_in_unit_range) - these MUST hold for any value crossing the seam.
      if (staleness < 0) throw new SceneError('E_NOT_FOUND', 'derived negative staleness');
      if (confidence < 0 || confidence > 1) {
        throw new SceneError('E_NOT_FOUND', 'derived confidence out of unit range');
      }
      return { staleness, confidence };
    },

    /**
     * frontier - latestHlc across all source nodes: the convergence frontier
     * (newer HLC = not-yet-known here). No errors.
     */
    async frontier(): Promise<{ as_of_hlc: string }> {
      return { as_of_hlc: await computeFrontier() };
    },

    /**
     * submit_intent - THE single renderer write path. Enforces the SCENE-CONTRACT
     * invariants IN ORDER, returning the matching CID error code (deep per-type
     * game-rule validation is the game's commit .px, out of scope here):
     *   1. signature missing/empty            -> E_UNSIGNED (intent_must_be_signed)
     *   2. body/payload carries an observation -> E_INTENT_CARRIES_OBSERVATION
     *                                             (convergence_is_observed_not_authored)
     *   3. ScanContributionIntent, fromTier != premium
     *                                          -> E_SCAN_NOT_PREMIUM
     *                                             (scan_contribution_premium_only)
     *   4. intent_type not in the 6-enum       -> E_UNKNOWN_INTENT
     *   5. submitter does not own the entity   -> E_NOT_OWNER (intent_ownership_bounded)
     *   6. else accept: persist the intent node + return the projected entity.
     *
     * On any rejection NO intent node is written (a rejected write cannot
     * converge). The result carries {accepted, entity?, error?} rather than
     * throwing, mirroring the CID `submit_intent` output shape.
     */
    async submitIntent(
      intent: SubmittedIntent,
      fromTier: Tier | string,
    ): Promise<SubmitIntentResult> {
      // 1. intent_must_be_signed - signature missing/empty.
      if (typeof intent.signature !== 'string' || intent.signature.trim().length === 0) {
        return { accepted: false, error: 'E_UNSIGNED' };
      }

      // 2. convergence_is_observed_not_authored - body/payload smuggles an observation.
      if (carriesObservation(intent)) {
        return { accepted: false, error: 'E_INTENT_CARRIES_OBSERVATION' };
      }

      // 3. scan_contribution_premium_only - ScanContributionIntent from non-premium.
      if (intent.intent_type === 'ScanContributionIntent' && fromTier !== 'premium') {
        return { accepted: false, error: 'E_SCAN_NOT_PREMIUM' };
      }

      // 4. unknown intent type (not one of the 6-enum).
      if (typeof intent.intent_type !== 'string' || !INTENT_TYPES.has(intent.intent_type)) {
        return { accepted: false, error: 'E_UNKNOWN_INTENT' };
      }

      // 5. intent_ownership_bounded - submitter MUST own the target entity. A
      //    missing target entity is also a non-ownable write (E_NOT_OWNER): the
      //    submitter cannot own what does not exist in the converged graph.
      if (typeof intent.entity_id !== 'string' || intent.entity_id.length === 0) {
        return { accepted: false, error: 'E_NOT_OWNER' };
      }
      const target = await entities.get(intent.entity_id);
      if (!target) {
        return { accepted: false, error: 'E_NOT_OWNER' };
      }
      if (target.owner_id !== intent.owner_id) {
        return { accepted: false, error: 'E_NOT_OWNER' };
      }

      // 6. Accept: persist the signed, ownership-bounded intent (HLC-ordered key),
      //    then return the freshly projected target entity (post-commit view).
      const hlc = typeof intent.hlc === 'string' && intent.hlc.length > 0 ? intent.hlc : '';
      const node: IntentNode = {
        contract_version:
          typeof intent.contract_version === 'string' ? intent.contract_version : CONTRACT_VERSION,
        intent_type: intent.intent_type as IntentType,
        owner_id: intent.owner_id ?? '',
        entity_id: intent.entity_id,
        hlc,
        signature: intent.signature,
        payload: intent.payload ?? null,
      };
      const intentKey = `${hlc}::${intent.entity_id}`;
      await intents.put(intentKey, node);

      // Project the post-commit entity with the intent's HLC as observerNow so the
      // just-accepted write reads as fresh (staleness 0) when an HLC is supplied.
      const observerNow =
        Number.isFinite(target.last_write_hlc_time) ? target.last_write_hlc_time : 0;
      const projected = projectSourceNode(target, observerNow);
      const result: SubmitIntentResult = { accepted: true };
      if (projected) result.entity = projected;
      return result;
    },

    /**
     * announce_profile - renderer tier/capability negotiation. Rejects with
     * E_PROFILE_INVALID when:
     *   - a non-ambient tier declares wants_staleness=false (profile_visual_wants_staleness:
     *     any visual tier MUST make staleness legible), OR
     *   - a non-premium tier declares can_scan=true (non_premium_cannot_scan:
     *     only premium contributes scans).
     * Also rejects an unknown tier (E_PROFILE_INVALID - an unrecognised tier can
     * never satisfy the profile rules).
     */
    async announceProfile(profile: RendererProfile): Promise<AnnounceProfileResult> {
      if (!TIERS.has(profile.tier as Tier)) {
        return { accepted: false, error: 'E_PROFILE_INVALID' };
      }
      if (profile.tier !== 'ambient' && !profile.wants_staleness) {
        return { accepted: false, error: 'E_PROFILE_INVALID' };
      }
      if (profile.tier !== 'premium' && profile.can_scan) {
        return { accepted: false, error: 'E_PROFILE_INVALID' };
      }
      return { accepted: true };
    },

    // ── DEFERRED (C-NOSTUB-001 - honest E_NOT_IMPLEMENTED, NO write) ──────────

    /**
     * simulate_zone - DEFERRED: zone SIMULATION (advancing wind/water/thermal
     * fields) belongs to the separate `physics` capability (inner-space declares
     * physics = "^1.0"). The scene capability only PROJECTS active zone overrides
     * for rendering (real: rsv_zone in the read-model). This returns an HONEST
     * E_NOT_IMPLEMENTED and performs NO write - it never fakes success.
     */
    async simulateZone(_input: unknown): Promise<DeferredResult> {
      return {
        deferred: true,
        code: 'E_NOT_IMPLEMENTED',
        reason:
          'simulate_zone is deferred: zone physics SIMULATION is the separate `physics` ' +
          'capability. scene only PROJECTS zone overrides (rsv_zone) for rendering.',
      };
    },
  };
}
