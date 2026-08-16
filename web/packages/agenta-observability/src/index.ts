// ============================================================================
// DASHBOARD ANALYTICS
// ============================================================================
export type {AnalyticsRange, AnalyticsRangeLabel, DashboardData} from "./core/types"
export {analyticsToDashboard, calculateIntervalFromDuration, formatTick} from "./core/analytics"
export {
    ANALYTICS_RANGE_PRESETS,
    resolveRangePreset,
    type AnalyticsRangePreset,
} from "./core/presets"
export {fetchDashboardAnalytics, type DashboardAnalyticsParams} from "./api/dashboard"
export {
    observabilityRangeAtom,
    observabilityDashboardQueryAtomFamily,
    useObservabilityDashboard,
    type ObservabilityDashboardState,
} from "./state"

// ============================================================================
// CORE TYPES & CONSTANTS
// ============================================================================
export type {
    Filter,
    FilterConditions,
    FilterValue,
    ObservabilityTabInfo,
    SortResult,
    SortTypes,
    TraceTabTypes,
    TraceTypeChoice,
} from "./core/types"
export type {TraceSpanNode} from "./core/traceSpan"
export {SESSIONS_PAGE_SIZE, TRACES_PAGE_SIZE} from "./core/constants"

// ============================================================================
// HOST SEAMS — the host writes these; the state layer reads them
// ============================================================================
export {
    bindObservabilityScopeAtom,
    bindObservabilityWorkflowContextAtom,
    observabilityScopeAtom,
    observabilityWorkflowContextAtom,
    type ObservabilityScope,
    type ObservabilityWorkflowContext,
} from "./state/seams"

// ============================================================================
// CONTROL STATE
// ============================================================================
export * from "./state/controls"

// ============================================================================
// QUERY STATE
// ============================================================================
export * from "./state/queries"

// ============================================================================
// SPAN SELECTORS
// ============================================================================
export * from "./state/selectors"

// ============================================================================
// HOOKS
// ============================================================================
export {useObservability} from "./hooks/useObservability"
export {useSessions} from "./hooks/useSessions"

// ============================================================================
// QUERY BUILDING
// ============================================================================
export {
    buildAnnotationConditions,
    buildFiltersForHasAnnotation,
    buildTraceQueryParams,
    executeTraceQuery,
    extractEarliestTimestamp,
    extractLinkedIds,
    mergeConditions,
    parseFilterJSON,
    toFilterString,
    type Condition,
} from "./api/queryHelpers"
export {default as buildTraceUrlParams} from "./utils/buildTraceQueryParams"
export {coerceNumericValue, parseNumericString} from "./utils/filterCoercion"

// ============================================================================
// FILTER ENGINE
// ============================================================================
export * from "./filters"

// ============================================================================
// ETL — bulk scan / export pipelines
// ============================================================================
export {adaptiveSleep} from "./etl/adaptiveExportPacing"
export {
    createAdaptiveTracePageFetcher,
    DEFAULT_TRACE_PAGE_SIZE,
    type AdaptiveTracePage,
    type AdaptiveTracePageFetcher,
    type AdaptiveTracePageFetcherConfig,
} from "./etl/adaptiveTracePageFetcher"
export {withRateLimitRetry, type RateLimitRetryOptions} from "./etl/withRateLimitRetry"
export * from "./etl/exportWriter"
export {createTraceObject, DEFAULT_TRACE_EXPORT_HEADERS} from "./etl/exportUtils"
