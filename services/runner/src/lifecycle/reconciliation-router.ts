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
  /** `setModel` on the running session. LIVE in v1. */
  readonly model: ActionKind;
  /** Instructions and skills, rewritten in place. LIVE in v1. */
  readonly workspaceFiles: ActionKind;
  /** System and append prompts. Never live: observation is not guaranteed. */
  readonly prompts: ActionKind;
  /** Opaque harness-rendered files. Never live: they may be permission files. */
  readonly harnessFiles: ActionKind;
  /** Mode, capabilities, permissions, MCP server list. Never live. */
  readonly harnessSession: ActionKind;
  /** The model-visible tool catalog. Uniformly reopen in v1. */
  readonly toolCatalog: ActionKind;
}

const V1_CAPABILITIES: Readonly<
  Record<HarnessKind, HarnessLifecycleCapabilities>
> = {
  // The two LIVE routes are `model` and `workspaceFiles`, uniformly across harnesses. Everything
  // else escalates. See the module comment for why the tool catalog is uniform rather than split.
  pi: {
    model: "apply-live",
    workspaceFiles: "refresh-workspace",
    prompts: "reopen-session",
    harnessFiles: "reopen-session",
    harnessSession: "reopen-session",
    toolCatalog: "reopen-session",
  },
  claude: {
    model: "apply-live",
    workspaceFiles: "refresh-workspace",
    prompts: "reopen-session",
    harnessFiles: "reopen-session",
    harnessSession: "reopen-session",
    toolCatalog: "reopen-session",
  },
  codex: {
    model: "apply-live",
    workspaceFiles: "refresh-workspace",
    prompts: "reopen-session",
    harnessFiles: "reopen-session",
    harnessSession: "reopen-session",
    toolCatalog: "reopen-session",
  },
  // An unrecognized harness gets the safest answer available. Fail closed, never fail open.
  unknown: {
    model: "rebuild-sandbox",
    workspaceFiles: "rebuild-sandbox",
    prompts: "rebuild-sandbox",
    harnessFiles: "rebuild-sandbox",
    harnessSession: "rebuild-sandbox",
    toolCatalog: "rebuild-sandbox",
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
    case "workspaceFiles":
      // Instructions and skills. The one workspace facet the runner may rewrite in place.
      return {
        facet,
        kind: capabilities.workspaceFiles,
        reason: "instructions or skills changed",
      };
    case "prompts":
      // Pi keeps these as files under its agent directory and a running process may already have
      // captured them, so the adapter matrix records active-session observation as NOT
      // GUARANTEED. Refreshing them and claiming the model saw it would be dishonest.
      return {
        facet,
        kind: capabilities.prompts,
        reason: "system or append prompt changed",
      };
    case "harnessFiles":
      // Opaque by construction, and they may BE permission files. `adapter-matrix.md` section
      // 4.3.2 rule 3 puts harness permission files alongside permission tightening and credential
      // revocation on the never-apply-live list, and the runner cannot tell one harness file from
      // another. So the whole facet escalates.
      return {
        facet,
        kind: capabilities.harnessFiles,
        reason: "harness-rendered configuration files changed",
      };
    case "model":
      // The one session-level change with a real live path: `setModel` on the running session.
      return {
        facet,
        kind: capabilities.model,
        reason: "requested model changed",
      };
    case "harnessSession":
      // Mode, capabilities, permissions, and the MCP server list. None is live: permission
      // tightening is exempt from apply-live by section 1.4, and no harness exposes a live API
      // for the MCP server list.
      return {
        facet,
        kind: capabilities.harnessSession,
        reason: "mode, permissions, or MCP servers changed",
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

/**
 * What KIND of question the coordinator was answering.
 *
 * This distinction is what makes the disagreement counter mean anything. The router only ever
 * answers one question: "does this ENVIRONMENT need rebuilding?" The coordinator answers a
 * broader one, and some of its reasons are not about the environment at all.
 *
 *  - `environment`: the decision was about the environment's configuration. The router's plan is
 *    directly comparable, so agreement and disagreement are both meaningful.
 *  - `continuity`: the decision was about the CONVERSATION — an edited transcript, a tail the
 *    runner did not write. The environment is untouched and the router correctly plans a no-op,
 *    so counting that as a disagreement would be a permanent false positive that no amount of
 *    router work could ever drive to zero.
 *
 * A continuity-scoped decision is still LOGGED, because seeing it is useful. It is simply not
 * counted.
 */
export type DecisionScope = "environment" | "continuity";

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
  /** Which question the decision answered. Defaults to `environment`. */
  scope?: DecisionScope;
  /**
   * The plan the caller ACTED ON, when it already has one.
   *
   * The live route needs this. It builds a plan, applies it, and commits the new applied state —
   * so by the time the shadow runs, recomputing from the environment yields an EMPTY plan and the
   * counter would record `no-op` instead of the route that was actually taken. A counter that
   * cannot name the route it is counting is useless for the rollout it exists to inform.
   */
  plan?: ReconcilePlan;
  log?: (message: string) => void;
}

/**
 * Agreement counters, per action kind.
 *
 * The rollout signal. A route is ready to go authoritative when its disagreement count sits at
 * zero across real traffic; a route that keeps disagreeing has a facet-ownership problem the
 * shadow is telling you about.
 *
 * Keyed by the plan's `maxAction`, so a counter names the ROUTE rather than the facet: several
 * facets can share one action kind, and it is the action that either works or does not.
 */
export interface ReconcileCounters {
  readonly agree: Readonly<Record<string, number>>;
  readonly disagree: Readonly<Record<string, number>>;
  /** Decisions excluded from the comparison because they were not about the environment. */
  readonly skippedByScope: number;
}

const counters = {
  agree: {} as Record<string, number>,
  disagree: {} as Record<string, number>,
  skippedByScope: 0,
};

/** Read the counters. Returns a copy, so a caller cannot mutate the live tallies. */
export function reconcileCounters(): ReconcileCounters {
  return {
    agree: { ...counters.agree },
    disagree: { ...counters.disagree },
    skippedByScope: counters.skippedByScope,
  };
}

/** Test seam: forget every tally. */
export function resetReconcileCounters(): void {
  counters.agree = {};
  counters.disagree = {};
  counters.skippedByScope = 0;
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
    const plan =
      input.plan ?? planReconcile(input.request, desired, input.appliedDigests);
    const scope = input.scope ?? "environment";
    const agree = plan.outcome === input.decision;
    // Count only what is comparable. A continuity decision is about the CONVERSATION, so the
    // router's environment plan is not an answer to the same question and counting it would
    // create a false positive that can never reach zero.
    if (scope === "continuity") {
      counters.skippedByScope += 1;
    } else {
      const bucket = agree ? counters.agree : counters.disagree;
      bucket[plan.maxAction] = (bucket[plan.maxAction] ?? 0) + 1;
    }
    // The marker is the point of the whole exercise: it is greppable, and a burst of DISAGREE
    // lines is the signal that the router's naming or ownership is still wrong.
    const marker =
      scope === "continuity" ? "n/a(continuity)" : agree ? "agree" : "DISAGREE";
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
 * 1. `mismatch:history` and `mismatch:tail`. RESOLVED, by classification rather than by code.
 *    The coordinator rebuilds the conversation; the router plans a no-op for the environment.
 *    Both are correct, because they answer DIFFERENT questions — which is the whole reason
 *    `DecisionScope` exists. These decisions are now marked `continuity`, logged for visibility,
 *    and excluded from the counters. Counting them would have left a permanent false positive
 *    that no router work could ever drive to zero.
 *
 *    The environment side of it was already right: step 1 gave a transcript mismatch the
 *    `continuity-invalid` teardown reason, which PARKS the sandbox instead of deleting it.
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

/**
 * The action kinds the runner may perform on a LIVE environment, as of step 6.
 *
 * EXACTLY TWO, and this constant is the single place that says so. `no-op` is here because an
 * empty plan is trivially satisfiable without touching anything.
 *
 * Adding a third entry is the whole decision to make another route live. It must not happen by
 * accident, so a test counts this set and the capability table is checked against it.
 */
export const LIVE_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "no-op",
  "apply-live",
  "refresh-workspace",
  // Step 6 (continued). A reopen keeps the sandbox, the daemon, the mounts and the workspace;
  // only the ACP session is recreated. It is what makes the uniform tool, MCP, prompt and
  // harness-file routes cheaper than a rebuild.
  //
  // It carries its own refusal: a session may only be reopened when the request carries a
  // transcript to replay, because native history cannot be positively verified. See
  // `harness-session-lifecycle.ts` `reopen`.
  "reopen-session",
]);

/**
 * Whether a plan can be satisfied ON THE RUNNING ENVIRONMENT.
 *
 * FAIL CLOSED: an empty action list is applicable (nothing to do), but a single action outside
 * the live set makes the whole plan inapplicable. A plan is all-or-nothing — applying the live
 * half of a mixed plan would leave the environment in a state no request described.
 */
export function isLivelyApplicable(plan: ReconcilePlan): boolean {
  return plan.actions.every((action) => LIVE_ACTION_KINDS.has(action.kind));
}
