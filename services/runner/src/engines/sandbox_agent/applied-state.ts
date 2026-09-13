/**
 * `AppliedEnvironmentState` — what an environment ACTUALLY has installed.
 *
 * LIFECYCLE MIGRATION, STEP 2. This is the smallest change that kills the stale-config bug class.
 *
 * The bug. Until now the pool stored a `configFingerprint` its CALLER supplied, and the caller
 * supplied the INCOMING request's fingerprint. On the ordinary path that is harmless, because the
 * dispatch already proved the incoming and parked configurations equal. On the approval-resume
 * path it is not: that branch never compares configurations, so the re-park stamped a
 * configuration the environment had never applied. The next turn then read that stamp, found a
 * match, and continued warm on an environment running something else.
 *
 * The fix is structural, not a patch. A request says what somebody WANTED. Only the environment
 * knows what it GOT. So the environment owns its applied state, and the pool reads it. There is
 * no fingerprint parameter left for a caller to stamp, which makes the bug unrepresentable rather
 * than merely fixed.
 *
 * Scope note. Step 2 carried one value, `configFingerprint`, because that is what the pool
 * compares. Step 4 adds `facets` beside it: the same request, split into the semantic facets the
 * reconciliation router diffs. The router needs to ask an environment what it applied PER FACET,
 * and a single whole-request hash cannot answer that. Both are stamped from the same successful
 * acquire, so they can never disagree.
 *
 * `generation` is Kubernetes' `observedGeneration`: it counts what this environment has actually
 * observed and installed. It never re-enters environment identity.
 */
import {
  normalizeDesiredState,
  type FacetDigests,
} from "../../lifecycle/desired-state.ts";
import type { AgentRunRequest } from "../../protocol.ts";
import { configFieldDigests, configFingerprint } from "./session-identity.ts";

/**
 * The state an environment has successfully installed. Read-only to everyone except
 * `commitApplied`.
 */
export interface AppliedEnvironmentState {
  /**
   * Increments on every successful commit. It is a monotonic counter for logs and for tests, and
   * it never re-enters environment identity. A test asserts that two commits of the same
   * fingerprint still advance it, so "nothing changed" and "we re-applied" stay distinguishable.
   */
  readonly generation: number;
  /**
   * The canonical hash of the configuration this environment actually runs. It is stamped from a
   * SUCCESSFUL acquire, never from an incoming request.
   */
  readonly configFingerprint: string;
  /**
   * The same configuration, split into the facets the reconciliation router diffs. Stamped from
   * the same successful acquire, so it can never disagree with `configFingerprint`.
   */
  readonly facets: FacetDigests;
  /**
   * Per-field digests of the same configuration (see `configFieldDigests`), so a config
   * mismatch can log WHICH fields changed — names only, values never leave the hash. Stamped
   * with the other two, so the three views describe one configuration.
   */
  readonly fieldDigests: Record<string, string>;
}

/**
 * The structural contract the pool needs. It is deliberately minimal: the pool must stay
 * engine-agnostic, so it constrains its environment type to this shape rather than importing the
 * engine.
 */
export interface AppliedStateOwner {
  readonly appliedState: AppliedEnvironmentState;
}

/**
 * A mutable holder for one environment's applied state.
 *
 * `commitApplied` is the ONLY way to advance it. Every caller must be a lifecycle action that
 * already succeeded. Committing before the action succeeds recreates the bug this module exists
 * to remove.
 */
export class AppliedState implements AppliedStateOwner {
  #generation: number;
  #configFingerprint: string;
  #facets: FacetDigests;
  #fieldDigests: Record<string, string>;

  constructor(
    configFingerprint: string,
    facets: FacetDigests,
    fieldDigests: Record<string, string>,
  ) {
    this.#generation = 1;
    this.#configFingerprint = configFingerprint;
    this.#facets = facets;
    this.#fieldDigests = fieldDigests;
  }

  get appliedState(): AppliedEnvironmentState {
    // A fresh object each read, so a caller cannot hold a reference and mutate it later.
    return {
      generation: this.#generation,
      configFingerprint: this.#configFingerprint,
      facets: { ...this.#facets },
      fieldDigests: { ...this.#fieldDigests },
    };
  }

  /**
   * Record a lifecycle action that ALREADY SUCCEEDED.
   *
   * Call this after the action, never before and never instead of it. A `setModel` that threw, a
   * workspace refresh that failed halfway, or a session reopen that lost its native history must
   * leave applied state exactly where it was. That is the partial-reconciliation rule from the
   * lifecycle design, and it is why this method takes a result rather than a desired value.
   */
  commitApplied(result: {
    configFingerprint: string;
    facets: FacetDigests;
    fieldDigests: Record<string, string>;
  }): void {
    this.#generation += 1;
    this.#configFingerprint = result.configFingerprint;
    this.#facets = result.facets;
    this.#fieldDigests = result.fieldDigests;
  }
}

/**
 * Build the applied state for the request that is BUILDING an environment.
 *
 * One place computes both halves from one request, so `configFingerprint` and `facets` can never
 * describe different configurations. Every caller that seeds or advances applied state should go
 * through this, including tests: a test that hand-builds the two halves can construct a state the
 * real code can never reach.
 */
export function appliedStateForRequest(request: AgentRunRequest): AppliedState {
  const result = appliedResultForRequest(request);
  return new AppliedState(
    result.configFingerprint,
    result.facets,
    result.fieldDigests,
  );
}

/**
 * The three applied-state views of one request, for `commitApplied` callers. One place computes
 * all of them, so no commit can stamp views of different configurations.
 */
export function appliedResultForRequest(request: AgentRunRequest): {
  configFingerprint: string;
  facets: FacetDigests;
  fieldDigests: Record<string, string>;
} {
  const fingerprint = configFingerprint(request);
  return {
    configFingerprint: fingerprint,
    facets: normalizeDesiredState(request, fingerprint).digests,
    fieldDigests: configFieldDigests(request),
  };
}
