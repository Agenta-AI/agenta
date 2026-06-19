/**
 * @agenta/evaluations/etl
 *
 * Eval-specific ETL adapters. See docs/designs/eval-etl-engine.md for
 * the design.
 *
 * @packageDocumentation
 */

// Hydrate transform shapes — the row/scenario/fetcher contracts shared by
// the column resolver and the cell-level materializer.
export type {
    HydratableScenario,
    HydratedScenarioRow,
    HydrateFetchers,
} from "./hydrateScenariosTransform"

// Column resolver — declarative, driven by run steps, source references, and
// column mappings. Groups columns by source (query / testset / application /
// evaluator / metrics) with no name-collision risk across evaluators.
export type {
    RunStep,
    RunMapping,
    RunSchema,
    ResolveSource,
    ResolvedColumn,
    ResolveContext,
    StepResolver,
    ResolveMappingsOptions,
    ColumnGroup,
    ResolvedColumnGroup,
    RunColumnLeaf,
    RunColumnGroup,
} from "./resolveMappings"
export {
    DEFAULT_STEP_RESOLVERS,
    resolveFromTestcase,
    resolveFromTrace,
    resolveFromMetric,
    composeResolvers,
    findInTrace,
    getAtPath,
    resolveMappings,
    computeColumnGroup,
    groupResolvedColumns,
    groupRunColumns,
} from "./resolveMappings"

export {
    getInputSourceAdapter,
    adaptInputSourceMappings,
    normalizeInputSourceValue,
    type InputSourceAdapter,
    type InputSourceGroup,
    type InputSourceKind,
    type InputSourceMapping,
    type InputSourceStep,
    type InputSourceStorage,
} from "./inputSourceAdapter"

// Cache diagnostics — inspect the TanStack cache + atom family sizes
export {
    DEFAULT_DIAGNOSTIC_PREFIXES,
    inspectCache,
    clearCacheByPrefix,
    type CacheDiagnostics,
    type CacheSliceStats,
} from "./cacheDiagnostics"
// Post-hydrate predicate filter — value-equality against resolved UI columns.
// Per eval-filtering.md §D2: this is the v1 frontend transform over already-
// loaded metric data. v2 server-side filter swaps the source's `filtering`
// param and this transform becomes a no-op.
//
// Multi-predicate AND/OR composition (decision D8) — `PredicateGroup` plus
// the `evaluate*` / `matchesRowFilter` row-level entry points and the
// `makePredicateGroupFilter` pipeline transform.
export {
    makeRowPredicateFilter,
    makePredicateGroupFilter,
    unwrapStatsForCompare,
    isPredicateGroup,
    evaluateRowPredicate,
    evaluatePredicateGroup,
    evaluateRowFilter,
    matchesRowFilter,
    type RowPredicate,
    type PredicateGroup,
    type RowFilter,
    type PredicateFilterOptions,
    type PredicateGroupFilterOptions,
} from "./rowPredicateFilter"

// Run-list predicate filter — the run-level counterpart to rowPredicateFilter.
// Drops whole RUNS from a run list by the ROLE their references play
// (subject / "application" vs grader / "evaluator"), reusing the same
// step.type → role convention. Powers "evaluations that evaluated THIS
// workflow" — the evaluator Evaluations/Overview unification (feature F).
export {
    collectRoleReferenceKeys,
    evaluateRunReferencePredicate,
    isSubjectRun,
    hasResolvableSubject,
    matchesRunReferenceFilter,
    makeRunReferenceFilter,
    type RunReferenceStep,
    type RunReferenceRole,
    type RunReferencePredicate,
    type RunReferenceFilterOptions,
} from "./runReferenceFilter"

// filterSchema — derives the filterable fields (typed + type-matched
// operators) the Phase 2 filter UI offers. Decision D8 / eval-filtering D4.
export {
    buildFilterSchema,
    operatorsForType,
    type FilterSchema,
    type FilterableField,
    type FilterValueType,
    type FilterOperator,
    type BuildFilterSchemaOptions,
} from "./filterSchema"

// Hit-ratio meter — v1→v2 escalation signal (reports the regime; doesn't
// swap engines today). Per eval-filtering.md §D2 + §C3: tracks rolling
// (matched/scanned) and recommends escalating to v2 when the ratio falls
// below threshold.
export {
    createHitRatioMeter,
    type HitRatioMeter,
    type HitRatioMeterOptions,
    type HitRatioRegime,
    type HitRatioState,
    type HitRatioWindow,
} from "./hitRatioMeter"

// Predicate → entity slice resolver — drives filter-aware hydrate so we
// don't fetch slices the active predicate(s) never touch (e.g. skip
// trace fetches when the filter only references evaluator metrics).
// Same direction-inverted convention as resolveMappings (which goes
// column → value); this goes column → entity-slice.
export {
    predicateToEntitySlices,
    type EntitySlice,
    type PredicateSliceResult,
} from "./predicateToEntitySlices"

// Filtering hooks + context — React-side ETL pieces (scenario filter state,
// page-level / cell-level hydration, scope eviction). Decision D8.
export {
    scenarioFilterAtomFamily,
    isConditionComplete,
    toEffectiveFilter,
    isScenarioFilterActive,
    scenarioFilterStatusAtomFamily,
    type ScenarioFilterStatus,
} from "./filtering/scenarioFilterState"
export {
    useHydrateScenarios,
    hydrationVersionAtom,
    type HydratableRowRef,
    type HydrationProgress,
    type SliceFetchMode,
    type UseHydrateScenariosArgs,
} from "./filtering/useHydrateScenarios"
export {
    useScenarioFilter,
    type UseScenarioFilterArgs,
    type UseScenarioFilterResult,
} from "./filtering/useScenarioFilter"
export {
    useScopeChangeEviction,
    type UseScopeChangeEvictionArgs,
} from "./filtering/useScopeChangeEviction"
export {useCellMaterialization, type CellMaterializer} from "./filtering/useCellMaterialization"
export {CellMaterializerContext} from "./filtering/cellMaterializerContext"
