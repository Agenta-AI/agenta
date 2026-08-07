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
 * Scope note. This slice carries one facet, `configFingerprint`, because that is the facet the
 * pool compares today. The richer shape in the lifecycle design (sandbox, runtime, mounts,
 * workspace, and harness-session facets, each with its own generation) arrives with the
 * reconciliation router. `generation` is here from the start so a later facet split has a counter
 * to build on.
 */

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

  constructor(configFingerprint: string) {
    this.#generation = 1;
    this.#configFingerprint = configFingerprint;
  }

  get appliedState(): AppliedEnvironmentState {
    // A fresh object each read, so a caller cannot hold a reference and mutate it later.
    return {
      generation: this.#generation,
      configFingerprint: this.#configFingerprint,
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
  commitApplied(result: { configFingerprint: string }): void {
    this.#generation += 1;
    this.#configFingerprint = result.configFingerprint;
  }
}
