/**
 * The reconciliation router: diff desired against applied, then produce a `ReconcilePlan`.
 *
 * LIFECYCLE MIGRATION, STEP 4, IN SHADOW MODE. The router runs on every dispatch and its plan
 * decides NOTHING. It is logged beside the decision the coordinator actually made, with a marker
 * when the two disagree. The shadow period is how naming and ownership stabilize before any reuse
 * behavior changes. Terraform calls this plan without apply.
 *
 * The whole module is pure. `planReconcile` reads two values and returns a third. It touches no
 * environment, starts nothing, and cannot fail a turn. That is deliberate: a shadow component
 * that can break the thing it shadows is worse than no shadow at all.
 */
import type { AgentRunRequest } from "../protocol.ts";
import {
  changedFacets,
  normalizeDesiredState,
  type DesiredEnvironmentState,
  type Facet,
  type FacetDigests,
} from "./desired-state.ts";
import {
  buildPlan,
  formatPlan,
  type ActionKind,
  type ReconcileAction,
  type ReconcilePlan,
} from "./reconcile-plan.ts";

export type HarnessKind = "pi" | "claude" | "codex" | "unknown";

/**
 * What each harness can do about a changed facet.
 *
 * V1 SETS EVERY TOOL CATALOG TO `reopen-session`. That is a product decision, not a technical
 * limit. The spike proved that Pi can register tools live and that Claude Code already handles
 * the MCP `tools/list_changed` notification, but Codex cannot, and a split where two harnesses go
 * live and the third silently behaves differently is worse than one uniform rule. The
 * `apply-live` kind stays in the vocabulary and this table stays the place to change, so enabling
 * one harness later is a one-line capability flip plus the shelved component.
 *
 * The shelved components, with their insertion points, are:
 *  - the untrusted best-effort acknowledgement (adapter-matrix.md section 4.3);
 *  - the Pi specs-file channel, replacing the `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` env var;
 *  - the MCP shim `tools.listChanged` capability plus its notification.
 */
export interface HarnessLifecycleCapabilities {
  readonly model: ActionKind;
  readonly toolCatalog: ActionKind;
  readonly mcpServers: ActionKind;
  readonly workspace: ActionKind;
}

const V1_CAPABILITIES: Readonly<
  Record<HarnessKind, HarnessLifecycleCapabilities>
> = {
  pi: {
    model: "reopen-session",
    toolCatalog: "reopen-session",
    mcpServers: "reopen-session",
    workspace: "refresh-workspace",
  },
  claude: {
    model: "reopen-session",
    toolCatalog: "reopen-session",
    mcpServers: "reopen-session",
    workspace: "refresh-workspace",
  },
  codex: {
    model: "reopen-session",
    toolCatalog: "reopen-session",
    mcpServers: "reopen-session",
    workspace: "refresh-workspace",
  },
  // An unrecognized harness gets the safest answer available. Fail closed, never fail open.
  unknown: {
    model: "rebuild-sandbox",
    toolCatalog: "rebuild-sandbox",
    mcpServers: "rebuild-sandbox",
    workspace: "rebuild-sandbox",
  },
};

export function harnessKind(request: AgentRunRequest): HarnessKind {
  const harness = request.harness;
  if (harness === "pi" || harness === "claude" || harness === "codex")
    return harness;
  return "unknown";
}

export function capabilitiesFor(
  request: AgentRunRequest,
): HarnessLifecycleCapabilities {
  return V1_CAPABILITIES[harnessKind(request)];
}

/** How each changed facet is repaired, given the harness's capabilities. */
function actionForFacet(
  facet: Facet,
  capabilities: HarnessLifecycleCapabilities,
): ReconcileAction {
  switch (facet) {
    case "sandbox":
      // The provider, the harness kind, and the network policy are all fixed at create time.
      // There is nothing to reconfigure on a sandbox that is the wrong sandbox.
      return {
        facet,
        kind: "rebuild-sandbox",
        reason: "provider, harness, or network policy changed",
      };
    case "runtime":
      // Model connection and credentials are baked into the daemon environment at start. Until
      // the provider port exposes a real credential refresh, the only sound answer is a restart.
      return {
        facet,
        kind: "restart-runtime",
        reason: "daemon environment or credential shape changed",
      };
    case "workspace":
      return {
        facet,
        kind: capabilities.workspace,
        reason: "managed workspace files changed",
      };
    case "harnessSession":
      return {
        facet,
        kind: capabilities.model,
        reason: "model, mode, permissions, or MCP servers changed",
      };
    case "toolCatalog":
      return {
        facet,
        kind: capabilities.toolCatalog,
        reason: "model-visible tool catalog changed",
      };
  }
}

/**
 * Build the plan for one dispatch.
 *
 * `applied` is undefined on a cold miss: there is no environment yet, so every facet counts as
 * changed and the plan is a rebuild. That is the honest answer, and it matches what the
 * coordinator does today.
 */
export function planReconcile(
  request: AgentRunRequest,
  desired: DesiredEnvironmentState,
  applied: FacetDigests | undefined,
): ReconcilePlan {
  const changed = changedFacets(desired.digests, applied);
  if (changed.length === 0) return buildPlan([], []);
  const capabilities = capabilitiesFor(request);
  const actions = changed.map((facet) => actionForFacet(facet, capabilities));
  return buildPlan(actions, changed);
}

/** What the coordinator actually decided, in the plan's own vocabulary. */
export type CoordinatorDecision = "reuse" | "rebuild";

export interface ShadowLogInput {
  key: string;
  request: AgentRunRequest;
  /** The whole-request fingerprint the coordinator compared. */
  configFingerprint: string;
  /** The environment's applied fingerprint, or undefined on a miss. */
  appliedFingerprint: string | undefined;
  /** The facet digests the environment has applied, or undefined on a miss. */
  appliedDigests: FacetDigests | undefined;
  /** The decision the coordinator made. This is what actually happened. */
  decision: CoordinatorDecision;
  /** The coordinator's own label for why, e.g. `mismatch:config` or `hit-continue`. */
  decisionReason: string;
  log?: (message: string) => void;
}

function defaultLog(message: string): void {
  process.stderr.write(`[reconcile] ${message}\n`);
}

/**
 * Build the plan and log it beside the coordinator's decision.
 *
 * The return value is the plan, so a test can assert on it without reading stderr. The logging is
 * the product of this step; the plan is what the next step will act on.
 *
 * WHAT IS SAFE TO LOG. Facet NAMES, action KINDS, the pool key, and the decision labels. Never a
 * digest, never a fingerprint, never a configuration value, never a credential. A facet digest is
 * derived from configuration, and a digest of a small field space is guessable, so digests stay
 * out of the log entirely.
 *
 * The function must never throw. A shadow component that can fail a turn is worse than none.
 */
export function logReconcileShadow(input: ShadowLogInput): ReconcilePlan | undefined {
  const rawLog = input.log ?? defaultLog;
  // A caller-supplied logger that throws must not fail the turn either: the catch below would
  // re-enter the same logger and the second throw would escape the shadow.
  const log = (line: string) => {
    try {
      rawLog(line);
    } catch {
      /* a shadow never fails a turn, not even for its own logger */
    }
  };
  try {
    const desired = normalizeDesiredState(
      input.request,
      input.configFingerprint,
    );
    const plan = planReconcile(input.request, desired, input.appliedDigests);
    const agree = plan.outcome === input.decision;
    // The marker is the point of the whole exercise: it is greppable, and a burst of DISAGREE
    // lines is the signal that the router's naming or ownership is still wrong.
    const marker = agree ? "agree" : "DISAGREE";
    log(
      `shadow key=${input.key} harness=${harnessKind(input.request)} ` +
        `decision=${input.decision}(${input.decisionReason}) ` +
        `plan=${plan.outcome}(${plan.maxAction}) ${marker} ` +
        `facets=[${formatPlan(plan)}]`,
    );
    return plan;
  } catch (err) {
    // Never fail a turn for a shadow. Log and move on.
    log(
      `shadow failed key=${input.key}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * KNOWN DISAGREEMENTS. Both were found by running the shadow, which is what it is for. Neither
 * may be treated as noise, and neither may be silenced by widening a facet.
 *
 * 1. `mismatch:history` and `mismatch:tail`. The coordinator rebuilds; the router plans a no-op.
 *    THE ROUTER IS RIGHT. A wrong transcript says nothing about the environment, which is exactly
 *    why step 1 gave it the `continuity-invalid` teardown reason that parks the sandbox rather
 *    than deleting it. Closing this gap means teaching the coordinator that a continuity failure
 *    needs a fresh CONVERSATION, not a fresh environment. That is a behavior change, so it waits
 *    for step 6.
 *
 * 2. `mismatch:credentials-*`. The coordinator rebuilds; the router plans a no-op.
 *    THE ROUTER IS WRONG, and this one is security-relevant. Credential VALUES are deliberately
 *    excluded from every facet digest, because digests are logged. So a rotated secret moves no
 *    facet, and the router cannot see it. Rotation is tracked by the credential EPOCH, a separate
 *    timing-safe comparison the router does not consult.
 *
 *    Until the router reads the epoch, it must never be made authoritative. A router that decides
 *    would reuse a daemon holding a revoked credential. The epoch belongs in the plan as its own
 *    input, producing a `restart-runtime` action; that is step 5's work, and
 *    `lifecycle-reconcile-plan.test.ts` pins the gap so it cannot be forgotten.
 */

/**
 * The facet digests an environment has applied.
 *
 * `AppliedEnvironmentState` now carries per-facet digests, and the coordinator passes them to
 * the shadow directly. This helper remains as the LEGACY reconstruction path: for an
 * environment built before the widening (or a caller that cannot supply digests), it recomputes
 * the desired digests from the request that BUILT the environment. With neither input the
 * router compares whole fingerprints and reports every facet as changed, which is why such a
 * shadow line reads `rebuild`.
 */
export function appliedDigestsFrom(
  acquiringRequest: AgentRunRequest | undefined,
  appliedFingerprint: string | undefined,
): FacetDigests | undefined {
  if (!acquiringRequest || !appliedFingerprint) return undefined;
  return normalizeDesiredState(acquiringRequest, appliedFingerprint).digests;
}
