/**
 * @agenta/evaluations/state/evalRun
 *
 * Eval-run runtime atom layer, relocated from `oss/src/components/EvalRunDetails` (WP-4e-2).
 * App-wide, OSS-state-coupled dependencies (workspace members, the testcase query family,
 * the App/Variant/Testset reference resolvers, run-table invalidation, metric-selection
 * cache-clear, and the annotation transform) are read through the injection seams in
 * `../evalRunInjection`; the OSS `-ui` layer populates them via `registerEvalRunInjections`.
 *
 * Inter-module imports stay relative. This barrel is the single public entry the OSS app
 * imports from.
 */

// ── run / project scope ──────────────────────────────────────────────────────
export * from "./atoms/run"
export * from "./atoms/runDerived"
export * from "./atoms/runInvocationAction"

// ── comparison ───────────────────────────────────────────────────────────────
export * from "./atoms/compare"

// ── query revisions ──────────────────────────────────────────────────────────
export * from "./atoms/query"

// ── references ───────────────────────────────────────────────────────────────
export * from "./atoms/references"

// ── variant config / testset details ─────────────────────────────────────────
export * from "./atoms/variantConfig"
export * from "./atoms/testsetDetails"

// ── annotations ──────────────────────────────────────────────────────────────
export * from "./atoms/annotations"
export type {AnnotationDto, AnnotationResponseDto, FullJson} from "./atoms/annotationTypes"

// ── metrics ──────────────────────────────────────────────────────────────────
export * from "./atoms/metricProcessor"
export * from "./atoms/metrics"
export * from "./atoms/runMetrics"
export * from "./atoms/runMetrics/types"

// ── scenarios ────────────────────────────────────────────────────────────────
export * from "./atoms/scenarioSteps"
export * from "./atoms/scenarioColumnValues"
export * from "./atoms/scenarioTestcase"
export * from "./atoms/types"

// ── traces ───────────────────────────────────────────────────────────────────
export * from "./atoms/traces"
export * from "./atoms/invocationTraceSummary"

// ── mutations ────────────────────────────────────────────────────────────────
export * from "./atoms/mutations/editEvaluation"

// ── table tier ───────────────────────────────────────────────────────────────
export * from "./atoms/table"

// ── siblings ─────────────────────────────────────────────────────────────────
export * from "./state/evalType"
export * from "./utils/valueAccess"
export * from "./utils/traceValue"
export * from "./utils/labelHelpers"
export * from "./constants/table"
export * from "./traces/traceUtils"
