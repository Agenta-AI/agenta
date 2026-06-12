/**
 * `@agenta/evaluations/state/runsTable` — the headless data layer for the evaluation-runs
 * table (relocated from `@/oss/components/EvaluationRunsTablePOC`, WP-4i).
 *
 * Holds the pure-data atoms, hooks, utils, types, and constants the runs-table view
 * consumes. The view COMPONENTS (cells, headers, the table, export UI, filters) and the
 * app-routing-coupled atoms (`context`, `view`, `tableStore`, `navigationActions` and the
 * column-builder / evaluator-reference hooks) remain in OSS and re-point here.
 */

// ── Types ──────────────────────────────────────────────────────────────────────
export type {
    LegacyAutoEvaluation,
    PreviewEvaluationRun,
    EvaluationRunSource,
    EvaluationRunKind,
    ConcreteEvaluationRunKind,
    PreviewRunColumnMeta,
    EvaluationRunApiRow,
    EvaluationRunTableRow,
    EvaluationRunsWindowResult,
} from "./types"
export type {RunMetricKind, RunMetricDescriptor} from "./types/runMetrics"
export type {
    ReferenceColumnExportMetadata,
    MetricColumnExportMetadata,
    CreatedByColumnExportMetadata,
    RunNameColumnExportMetadata,
    EvaluationRunsColumnExportMetadata,
} from "./types/exportMetadata"

// ── Constants ──────────────────────────────────────────────────────────────────
export {
    STATUS_OPTIONS,
    FLAG_LABELS,
    EVALUATION_KIND_LABELS,
    EVALUATION_KIND_FILTER_OPTIONS,
    METRIC_COLUMN_CONFIG,
    INVOCATION_METRIC_KEYS,
    INVOCATION_METRIC_LABELS,
} from "./constants"
export type {FlagKey} from "./constants"

// ── Utils ──────────────────────────────────────────────────────────────────────
export {
    REFERENCE_ROLE_LABELS,
    buildReferenceSequence,
    buildReferenceBlueprint,
    getSlotByRoleOrdinal,
    buildReferenceColumnKey,
} from "./utils/referenceSchema"
export type {
    ReferenceRole,
    ReferenceValue,
    ReferenceSlot,
    ReferenceColumnDescriptor,
} from "./utils/referenceSchema"
export {buildReferencePayload} from "./utils/referencePayload"
export {formatFilterValue, summarizeQueryFilters} from "./utils/querySummary"
export type {QuerySummaryFilter} from "./utils/querySummary"
export {buildTestsetOptions} from "./utils/testsetOptions"
export {deriveAppIds, resolveRowAppId, deletePreviewRuns} from "./utils/runHelpers"
export {isUuid, getUniquePartOfId} from "./utils/uuid"

// ── Atoms ──────────────────────────────────────────────────────────────────────
export {
    createEvaluatorOutputTypesKey,
    getOutputTypesMap,
    setOutputTypesMap,
    subscribeToOutputTypes,
    getOutputTypesVersion,
    isStringOutputType,
    isMetricVisibleByOutputType,
} from "./atoms/evaluatorOutputTypes"
export {previewRunSummaryAtomFamily} from "./atoms/runSummaries"
export type {PreviewRunSummary} from "./atoms/runSummaries"
export {fetchEvaluationRunsWindow} from "./atoms/fetchAutoEvaluationRuns"

// ── Hooks ──────────────────────────────────────────────────────────────────────
export {default as usePreviewRunDetails} from "./hooks/usePreviewRunDetails"
export {default as usePreviewRunSummary} from "./hooks/usePreviewRunSummary"
export {
    default as useRunMetricSelection,
    clearMetricSelectionCache,
    invalidateMetricSelectionCache,
} from "./hooks/useRunMetricSelection"
export {default as useEvaluationRunsPolling} from "./hooks/useEvaluationRunsPolling"

// ── Row data context (hooks) ─────────────────────────────────────────────────────
export {useRunRowSummary, useRunRowDetails, useRunRowReferences} from "./RunRowDataContext"
