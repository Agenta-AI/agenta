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

/**
 * Session-scoped list-column tier. Reads the session engine's injected scenario
 * `kind` + `{projectId, runId}` context to build trace- vs testcase-shaped
 * scenario-list columns. Zero-arg atom getters (like the engine selectors).
 */
export * from "./listColumns"

/**
 * Generic metric/schema-extraction tier. Pure functions relocated from the
 * annotation form controller: schema → metric-field extraction and evaluator
 * resolution + baseline computation. Entities-only, no atoms; reactive helpers
 * take a jotai `Getter` from the consumer's store.
 */
export * from "./metricSchema"
