/**
 * `ReconcilePlan` — an explicit, inert description of what reconciliation WOULD do.
 *
 * LIFECYCLE MIGRATION, STEP 4. This is Terraform's plan-then-apply, borrowed deliberately. A plan
 * is a value. Building one runs nothing, changes nothing, and needs no environment. So a plan can
 * be logged, asserted on in a unit test, and compared against the decision the old code makes —
 * which is exactly what shadow routing needs. "Shadow mode" is then not a special mode at all. It
 * is plan without apply.
 *
 * THE ACTION VOCABULARY IS THE POINT OF THIS FILE. `apply-live` is a first-class action kind even
 * though v1 emits it for nothing. The team decided that per-harness live routes must be cheaply
 * EXPRESSIBLE without being implemented, so the vocabulary carries the full range now and the
 * adapter capability table decides what is reachable. Enabling one harness later is then a
 * capability flip plus the shelved component, not a redesign of this type.
 */
import type { Facet } from "./desired-state.ts";

/**
 * What reconciliation can do about a changed facet, cheapest first.
 *
 * The order matters: `maxAction` below picks the most expensive action in a plan, and it relies
 * on this array being sorted from cheapest to most expensive.
 */
export const ACTION_KINDS = [
  "no-op",
  /**
   * Change it on the running session, with no reopen and no restart.
   *
   * NOT REACHED IN V1. Every harness's tool-catalog capability is `reopen-session`, per the PR
   * review decision: uniform behavior beats a per-harness split where two harnesses go live and
   * the third breaks the pattern. The kind stays here so enabling a harness is a capability
   * change rather than a vocabulary change. Anything that emits this must first prove the
   * adapter acknowledges the new generation; see `adapter-matrix.md` section 1.
   */
  "apply-live",
  /** Rewrite the managed files in the run directory. The session and the daemon survive. */
  "refresh-workspace",
  /** Close and reopen the ACP session on the same sandbox. The daemon survives. */
  "reopen-session",
  /** Restart the agent daemon. The sandbox survives; everything installed in it does not. */
  "restart-runtime",
  /** Destroy the sandbox and build a new one. The most expensive action. */
  "rebuild-sandbox",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

/** One planned action: which facet asked for it, what to do, and why. */
export interface ReconcileAction {
  readonly facet: Facet;
  readonly kind: ActionKind;
  /** A short, content-free explanation. It is logged, so it must never carry configuration. */
  readonly reason: string;
}

/** The outcome a plan implies for the session, in the vocabulary the current dispatch uses. */
export type PlanOutcome = "reuse" | "rebuild";

export interface ReconcilePlan {
  /** In `FACETS` order, which is the order the actions must run in. */
  readonly actions: readonly ReconcileAction[];
  /** The most expensive action in the plan. `no-op` when the plan is empty. */
  readonly maxAction: ActionKind;
  /** `reuse` when the plan can be satisfied without building a new sandbox. */
  readonly outcome: PlanOutcome;
  readonly changedFacets: readonly Facet[];
}

function rank(kind: ActionKind): number {
  return ACTION_KINDS.indexOf(kind);
}

/** The most expensive action among `actions`. Empty means nothing to do. */
export function maxAction(actions: readonly ReconcileAction[]): ActionKind {
  let worst: ActionKind = "no-op";
  for (const action of actions) {
    if (rank(action.kind) > rank(worst)) worst = action.kind;
  }
  return worst;
}

/**
 * Build a plan from its actions.
 *
 * The outcome is derived, never passed in. Only `rebuild-sandbox` forces a rebuild; every other
 * action, including `restart-runtime`, keeps the sandbox. Deriving it means a new action kind
 * cannot be added without deciding which side of this line it falls on.
 */
export function buildPlan(
  actions: readonly ReconcileAction[],
  changed: readonly Facet[],
): ReconcilePlan {
  const worst = maxAction(actions);
  return {
    actions,
    maxAction: worst,
    outcome: worst === "rebuild-sandbox" ? "rebuild" : "reuse",
    changedFacets: changed,
  };
}

/** The empty plan. Nothing changed, so there is nothing to do. */
export const EMPTY_PLAN: ReconcilePlan = buildPlan([], []);

/**
 * One line, safe to log: `sandbox=rebuild-sandbox workspace=refresh-workspace`.
 *
 * Facet names and action kinds only. No digests, no configuration, no credentials.
 */
export function formatPlan(plan: ReconcilePlan): string {
  if (plan.actions.length === 0) return "none";
  return plan.actions.map((a) => `${a.facet}=${a.kind}`).join(" ");
}
