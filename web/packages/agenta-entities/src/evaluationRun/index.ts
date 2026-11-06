/**
 * @agenta/entities/evaluationRun
 *
 * Evaluation run entity — read-only access to evaluation run data
 * with automatic batch fetching for individual run queries.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { evaluationRunMolecule } from '@agenta/entities/evaluationRun'
 *
 * // Read run data (batch-fetched automatically)
 * const data = useAtomValue(evaluationRunMolecule.selectors.data(runId))
 *
 * // Get annotation steps (evaluators)
 * const steps = useAtomValue(evaluationRunMolecule.selectors.annotationSteps(runId))
 *
 * // Get evaluator workflow IDs from annotation step references
 * const ids = useAtomValue(evaluationRunMolecule.selectors.evaluatorIds(runId))
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// MOLECULE
// ============================================================================

export {
    evaluationRunMolecule,
    type EvaluationRunMolecule,
    type AnnotationColumnDef as EvaluationRunAnnotationColumnDef,
} from "./state/molecule"

// Per-scenario read-only molecules (cache-aware bulk prefetch).
// Used by ETL hydrate + downstream cell renderers.
export {
    evaluationResultMolecule,
    type EvaluationResultMolecule,
    type PrefetchResultsArgs,
    type PrefetchResultsOutcome,
} from "./state/resultMolecule"
export {
    evaluationMetricMolecule,
    type EvaluationMetricMolecule,
    type PrefetchMetricsArgs,
    type PrefetchMetricsOutcome,
} from "./state/metricMolecule"

// ============================================================================
// SCHEMAS & TYPES
// ============================================================================

export {
    // Enums
    evaluationRunStepTypeSchema,
    evaluationRunStepOriginSchema,
    evaluationRunMappingKindSchema,
    // Sub-schemas
    evaluationRunDataStepSchema,
    type EvaluationRunDataStep,
    evaluationRunDataMappingSchema,
    type EvaluationRunDataMapping,
    evaluationRunDataSchema,
    evaluationRunFlagsSchema,
    type EvaluationRunFlags,
    // Entity
    evaluationRunSchema,
    type EvaluationRun,
    // Response
    evaluationRunResponseSchema,
    type EvaluationRunResponse,
    evaluationRunsResponseSchema,
    type EvaluationRunsResponse,
    // Evaluation Results (Scenario Steps)
    evaluationResultSchema,
    type EvaluationResult,
    evaluationResultsResponseSchema,
    type EvaluationResultsResponse,
    // Evaluation Metrics
    type EvaluationMetric,
    // Param types
    type EvaluationRunDetailParams,
    type EvaluationRunQueryParams,
    type EvaluationResultsQueryParams,
    // Run kind, status rules and the human run builder
    deriveEvaluationKind,
    EVALUATION_KIND_LABELS,
    humanizeRunStatus,
    isRunInProgress,
    isTerminalRunStatus,
    runDisplayStatus,
    runStatusTone,
    type EvaluationRunKind,
    type RunKindInput,
    type RunStatusTone,
    buildHumanRunConfig,
    evaluatorOutputKeys,
    type BuildHumanRunConfigInput,
    type HumanRunApp,
    type HumanRunEvaluator,
    type HumanRunSpec,
    type HumanRunStep,
    type HumanRunMapping,
    type HumanRunTestset,
    // Metric stats: summaries, chart rows and formats
    booleanTruePercent,
    format3Sig,
    formatCost,
    formatDuration,
    formatTokens,
    frequencyBars,
    histogramBars,
    isAggregatableMetric,
    isBooleanMetricStats,
    metricSummary,
    normalizeMetricStats,
    radarAxes,
    RADAR_FALLBACK_INVOCATION_IDS,
    type MetricBar,
    type MetricBin,
    type MetricFrequency,
    type MetricStats,
    type MetricSummary,
    type RadarMetricInput,
    findScenarioTraceResult,
    buildQuerySlug,
    formatQueryFiltering,
    formatQuerySampleRate,
    LIVE_INVOCATION_FILTER,
    parseSamplingRate,
    selectLiveEvaluators,
    type LiveFilterRow,
    // Shared evaluation logic (copied from the old app)
    buildRunStatsMap,
    INVOCATION_METRIC_PREFIX,
    invocationMetricValues,
    mergeMetricStats,
    runLevelMetricRow,
    selectRunMetricStats,
    type RunStatsMap,
    formatMetricNumber,
    formatMetricValue,
    humanizeMetricLabel,
    METRIC_PLACEHOLDER,
    buildRunEditBody,
    type RunEditBody,
    type RunEditInput,
    type RunStepOrigin,
    buildRunReferencePayload,
    buildRunsQueryBody,
    countRunListFilters,
    runListTabFlags,
    type RunFlagsFilter,
    type RunListFilterState,
    type RunListTab,
    type RunReferenceFilterKey,
    type RunReferenceFilters,
    type RunReferencePayload,
    type RunsQueryBody,
    type RunsQueryInput,
    type RunsQueryWindowing,
    buildCsv,
    csvCell,
    metricExportHeader,
    metricExportValue,
    runExportCreatedAt,
    runExportFilename,
    runExportKind,
    runExportName,
    runExportStatus,
    type RunExportInput,
    COMPARE_QUERY_KEY,
    compareBlockReason,
    compareCandidates,
    compareParamValue,
    MAX_COMPARISON_RUNS,
    parseCompareParam,
    runComparisonStructure,
    toggleCompareRun,
    type CompareBlockReason,
    type CompareRunInput,
    type RunComparisonStructure,
} from "./core"

// ============================================================================
// API
// ============================================================================

export {
    fetchEvaluationRun,
    queryEvaluationRuns,
    queryEvaluationResults,
    queryEvaluationRunsPage,
    evaluationRunsListQueryKey,
    evaluationRunQueryKey,
    seedEvaluationRunCache,
    deleteEvaluationRuns,
    editEvaluationRun,
    processNewEvaluatorSteps,
    startOnlineEvaluation,
    stopOnlineEvaluation,
    createAutoEvaluationRuns,
    createHumanEvaluationRun,
    createLiveEvaluation,
    fetchAllTestcaseIds,
    DEFAULT_EVALUATION_CONCURRENCY,
    type EvaluationRunsPageParams,
    type EvaluationRunsPage,
    type EvaluationRunsListKeyParams,
    type EvaluationRunActionParams,
    type EvaluationConcurrency,
    type CreateAutoEvaluationRunsParams,
    type CreateAutoEvaluationRunsResult,
    type CreateLiveEvaluationParams,
    findEvaluationRunsUsing,
    // Run details
    queryEvaluationScenariosPage,
    queryRunLevelMetrics,
    type EvaluationRunScenario,
    type EvaluationScenariosPage,
    type EvaluationScenariosPageParams,
} from "./api"

// ============================================================================
// STATE
// ============================================================================

export {
    evaluationRunQueryAtomFamily,
    scenarioStepsQueryAtomFamily,
    invalidateEvaluationRunCache,
    // Run details page
    runHeaderAtomFamily,
    runReferencesAtomFamily,
    runQueryConfigQueryAtomFamily,
    type RunQueryConfig,
    runLevelMetricsQueryAtomFamily,
    runLevelMetricsQueryKey,
    runMetricCatalogAtomFamily,
    buildRunMetricCatalog,
    INVOCATION_METRICS,
    metricLabel,
    RUN_METRICS_REFRESH_MS,
    type RunEvaluatorReference,
    type RunHeader,
    type RunMetricEntry,
    type RunQueryReference,
    type RunReferences,
    type RunTestsetReference,
    type TemporalMetricPoint,
} from "./state"
