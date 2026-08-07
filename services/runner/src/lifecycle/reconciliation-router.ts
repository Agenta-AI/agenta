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
import type { CredentialDeliveryMechanism } from "../providers/credential-delivery-port.ts";
import {
  changedFacets,
  FACETS,
  normalizeDesiredState,
  type DesiredEnvironmentState,
  type Facet,
  type FacetDigests,
} from "./desired-state.ts";
import {
  ACTION_KINDS,
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
  /** Instructions and skills. Never live: the harness reads them once, at session start. */
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

/**
 * WHY `workspaceFiles` IS `rebuild-sandbox` AND NOT `refresh-workspace`.
 *
 * It was `refresh-workspace` and that was a live route: an instructions edit rewrote `AGENTS.md`
 * on the running sandbox and kept the session. Live QA cell `matrix_l5_live_route_observed.py`
 * proved the route is a SILENT LIE. Every harness reads its instruction file ONCE, when the
 * session starts. So the refresh wrote the new file, `applyReconcilePlan` committed the incoming
 * configuration as applied, the pool then reported the NEW fingerprint — so every later turn
 * matched and continued warm — while the model went on answering from the instructions it was
 * started with. The user's edit had no effect until something else evicted the session.
 *
 * That is the exact failure the whole applied-state design exists to make unrepresentable, and
 * `desired-state.ts` already refuses it for the `prompts` facet in these words: "a running process
 * may have captured their location or content already. Refreshing them and claiming the model saw
 * the change would be a lie". The same argument always applied to instructions. This table simply
 * says so now.
 *
 * REBUILD RATHER THAN REOPEN. A reopen is the mechanism this facet will eventually want, but
 * `env.reopenSession` closes over the session init the environment was BUILT with and writes no
 * files, so routing here would install nothing while reporting the new configuration as applied —
 * the same lie in a cheaper costume. A rebuild is wasteful and always sound, and it is exactly
 * what an instructions edit cost before the live route existed.
 *
 * THE FOLLOW-UP, when someone takes it: refresh the workspace and THEN reopen the session, so the
 * new files are on disk before the harness reads them. That needs the reopen to rebuild its
 * session init from the incoming request first (`adapter-matrix.md` section 8, steps 1 and 2),
 * and it needs proving on a live cell, not asserting.
 */
const V1_CAPABILITIES: Readonly<
  Record<HarnessKind, HarnessLifecycleCapabilities>
> = {
  // ONE live route remains: `model`. Everything else escalates. See the module comment for why the
  // tool catalog is uniform rather than split, and the block above for why the workspace escalates.
  pi: {
    model: "apply-live",
    workspaceFiles: "rebuild-sandbox",
    prompts: "reopen-session",
    harnessFiles: "reopen-session",
    harnessSession: "reopen-session",
    toolCatalog: "reopen-session",
  },
  claude: {
    model: "apply-live",
    workspaceFiles: "rebuild-sandbox",
    prompts: "reopen-session",
    harnessFiles: "reopen-session",
    harnessSession: "reopen-session",
    toolCatalog: "reopen-session",
  },
  codex: {
    model: "apply-live",
    workspaceFiles: "rebuild-sandbox",
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
      // Instructions and skills. The runner CAN rewrite these in place; what it cannot do is make
      // a running harness read them again. See the capability table for the live-QA cell that
      // caught the difference.
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
 * How a credential rotation reaches the plan.
 *
 * LIFECYCLE MIGRATION, STEP 8. This is the input that closes the credential gap, and its SHAPE is
 * the whole point: a rotation arrives as a MECHANISM, not as a digest.
 *
 * WHY NOT A NINTH FACET. Facet digests are logged. A digest over credential values would be a
 * digest over a small, guessable field space, so credential values are excluded from every facet
 * by construction — which is exactly why the router could not see a rotation before this. Adding a
 * credential facet would either log a digest of secret material or log nothing useful. So the
 * epoch stays where it belongs (an opaque timing-safe comparison, owned by the credential
 * subsystem) and only its CONCLUSION reaches the router.
 *
 * WHY THE CALLER DECIDES THE MECHANISM. Which action a rotation needs is PROVIDER-DEPENDENT: it
 * depends on whether the sandbox holds values or references, and on whether the provider bounds
 * its egress propagation. The router is pure and knows nothing about providers, so the coordinator
 * computes the mechanism with `planCredentialDelivery` and passes the answer in. The router's job
 * is to place that answer in the plan beside the facet actions, in the same vocabulary.
 */
export interface CredentialRotationInput {
  /** The delivery mechanism the provider's capabilities imply, or undefined when nothing rotated. */
  readonly mechanism: CredentialDeliveryMechanism | undefined;
}

/** The action kind a delivery mechanism maps onto. No new kind enters the vocabulary. */
function actionKindForMechanism(
  mechanism: CredentialDeliveryMechanism,
): ActionKind {
  switch (mechanism) {
    // A rotation behind a stable, BOUNDED reference changes nothing inside the sandbox: the
    // placeholder it holds is unchanged, so there is nothing to restart and nothing to rebuild.
    case "rotate-in-place":
      return "apply-live";
    case "restart-runtime":
      return "restart-runtime";
    case "rebuild-sandbox":
      return "rebuild-sandbox";
  }
}

/**
 * Build the plan for one dispatch.
 *
 * `applied` is undefined on a cold miss: there is no environment yet, so every facet counts as
 * changed and the plan is a rebuild. That is the honest answer, and it matches what the
 * coordinator does today.
 *
 * `credential` carries the rotation conclusion. It is a SEPARATE INPUT rather than a facet, for
 * the reasons on `CredentialRotationInput`.
 */
export function planReconcile(
  request: AgentRunRequest,
  desired: DesiredEnvironmentState,
  applied: FacetDigests | undefined,
  credential: CredentialRotationInput = { mechanism: undefined },
): ReconcilePlan {
  const changed = changedFacets(desired.digests, applied);
  const capabilities = capabilitiesFor(request);
  const actions = changed.map((facet) => actionForFacet(facet, capabilities));

  if (credential.mechanism) {
    const kind = actionKindForMechanism(credential.mechanism);
    // The credential action lands on `runtime`, which already owns "what is baked into the daemon".
    // If the runtime facet ALSO moved (a changed credential SHAPE, a changed model connection), the
    // two must not become two actions on one facet: `applyReconcilePlan` iterates actions in facet
    // order and would run the same facet twice. Keep the MORE EXPENSIVE of the two, because a facet
    // needing both a rotation and a shape change needs whichever repair is stronger.
    const existing = actions.find((action) => action.facet === "runtime");
    const credentialAction: ReconcileAction = {
      facet: "runtime",
      kind,
      // Content-free, like every other reason in this file. It says a rotation happened, never
      // which credential, never any part of a value.
      reason: "credential material rotated",
    };
    if (!existing) {
      actions.push(credentialAction);
      // `changedFacets` returns facets in FACETS order and the plan must stay in that order, so
      // re-derive rather than appending to `changed`.
      const withRuntime = FACETS.filter(
        (facet) => changed.includes(facet) || facet === "runtime",
      );
      actions.sort(
        (left, right) =>
          FACETS.indexOf(left.facet) - FACETS.indexOf(right.facet),
      );
      return buildPlan(actions, withRuntime);
    }
    if (rankOf(kind) > rankOf(existing.kind)) {
      actions[actions.indexOf(existing)] = credentialAction;
    }
    return buildPlan(actions, changed);
  }

  if (changed.length === 0) return buildPlan([], []);
  return buildPlan(actions, changed);
}

/** Cheapness rank, from the one ordered vocabulary. Used to keep the stronger of two repairs. */
function rankOf(kind: ActionKind): number {
  return ACTION_KINDS.indexOf(kind);
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
   * The credential rotation conclusion for this dispatch, when there is one.
   *
   * STEP 8. Without this the shadow recomputes a plan that cannot see a rotation, and the counter
   * records a disagreement that no router work could ever fix — which is exactly what the KNOWN
   * DISAGREEMENTS block used to describe.
   */
  credential?: CredentialRotationInput;
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
export function logReconcileShadow(
  input: ShadowLogInput,
): ReconcilePlan | undefined {
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
      input.plan ??
      planReconcile(
        input.request,
        desired,
        input.appliedDigests,
        input.credential ?? { mechanism: undefined },
      );
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
 * 2. `mismatch:credentials-*`. RESOLVED IN STEP 8, and the resolution is not the one this block
 *    predicted. The gap was real: credential VALUES are excluded from every facet digest because
 *    digests are logged, so a rotated secret moved no facet and the router could not see it.
 *
 *    THE FIX. The epoch stays out of the facets — putting it in would mean logging a digest of
 *    secret material — and reaches the plan as its own input, `CredentialRotationInput`. The router
 *    now emits an action on the `runtime` facet for a rotation, so a rotated credential is visible
 *    to the plan without any secret entering a digest.
 *
 *    WHAT CHANGED FROM THE PREDICTION, AND WHY IT MATTERS. This block used to mandate
 *    `restart-runtime`. That was wrong for the provider we actually have. Which action a rotation
 *    needs is PROVIDER-DEPENDENT:
 *
 *      - Where the sandbox holds VALUES, a restart installs the new one, so `restart-runtime`.
 *      - Where the sandbox holds a stable REFERENCE and the provider BOUNDS how long its egress
 *        layer takes to apply a rotated value, nothing inside the sandbox changes at all and the
 *        action is `apply-live`. An external security review accepted that mapping on three
 *        conditions, all met here: a dedicated credential-route test, this rewrite rather than a
 *        deletion, and the `LIVE_ACTION_KINDS` comment fix below.
 *      - Where the sandbox holds a reference the provider does NOT bound, a restart would hand the
 *        new process the SAME placeholder and deliver nothing. The only honest action is
 *        `rebuild-sandbox`. Daytona bounds its propagation, so it takes the live route; a provider
 *        that withdrew its bound would fall back here by that capability value alone.
 *
 *    So the router is no longer wrong, and it is no longer silent. It says what the provider can
 *    actually do. `lifecycle-reconcile-plan.test.ts` and `lifecycle-live-routes.test.ts` pin each
 *    route, including the rebuild, so a capability change cannot quietly widen the live set.
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
 * The action kinds the runner may perform on a LIVE environment.
 *
 * TWO, and this constant is the single place that says so. The comment once said "exactly two"
 * long after the set had grown, which an external security review caught: a stale count in the one
 * place that claims to be authoritative is worse than no count, because it is what a reviewer
 * checks against. `no-op` is here because an empty plan is trivially satisfiable without touching
 * anything.
 *
 * TWO KINDS WERE MEMBERS AND ARE NOT NOW. Both left for the same reason, and it is the reason this
 * set exists: they changed the environment in a way the running harness never observed, while
 * `applyReconcilePlan` committed the incoming configuration as applied.
 *
 *  - `reopen-session`. A reopen recreates the ACP session from the session init the environment
 *    was BUILT with (`env.reopenSession` closes over it), so it reinstalls the old MCP list, the
 *    old prompts and the old harness files, while the turn keeps serving the old tool catalog from
 *    `env.plan`. `adapter-matrix.md` section 8 steps 1 and 2 are the prerequisite.
 *  - `refresh-workspace`. The refresh really does rewrite `AGENTS.md` on the running sandbox, but
 *    every harness reads that file once, at session start, so the model kept answering from the
 *    instructions it was started with. Live cell `matrix_l5_live_route_observed.py` caught it. The
 *    capability table carries the full account.
 *
 * The kind stays in the vocabulary and `apply-plan.ts` keeps the applier, because a
 * refresh-then-reopen route is what this facet eventually wants. It is not live until a live cell
 * proves the harness observed the change.
 *
 * NOTHING ROUTES TO `refresh-workspace` TODAY, and this membership is still the thing to change,
 * not the only one. Removing it means a capability table flipped back to `refresh-workspace` fails
 * CLOSED — the plan escalates and this guard's test fires — rather than quietly going live again.
 *
 * Adding an entry is the whole decision to make another route live. It must not happen by
 * accident, so a test counts this set and the capability table is checked against it.
 */
export const LIVE_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  "no-op",
  "apply-live",
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
