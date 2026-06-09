/**
 * @agenta/evaluations/state
 *
 * Stateful evaluation engine (jotai). The session engine owns scenario navigation /
 * progress / focus / view over an injected scenario source; consumers (annotation queues,
 * the eval-run view) inject their own source.
 */
export * from "./session"

/**
 * Generic scenario-data, evaluator, and metrics selectors. Source-agnostic,
 * keyed purely by `{projectId, runId[, scenarioId]}` — no queue concepts, no
 * session reads, no `@agenta/annotation` dependency.
 */
export * from "./scenarioData"
