/**
 * @agenta/entities/evaluationRun/etl
 *
 * Eval-specific ETL adapters. See docs/designs/eval-etl-engine.md for
 * the design.
 *
 * Currently exposed:
 *   - makeRealScenarioSource: minimal real Source that hits
 *     /evaluations/scenarios/query directly. Used by the PoC; will
 *     eventually be replaced by makeSource(scenariosPaginatedStore)
 *     once Phase 1-2 of the architecture RFC lands.
 *
 * @packageDocumentation
 */

export type {RealEvaluationScenario, RealScenarioSourceParams} from "./realScenarioSource"
export {makeRealScenarioSource} from "./realScenarioSource"

// Hydrate transform — joins each scenario chunk to its correlated entities
// (results, metrics, testcases, traces) via injected HydrateFetchers.
export type {
    HydratableScenario,
    HydratedScenarioRow,
    HydrateScenariosTransformParams,
    HydrateFetchers,
} from "./hydrateScenariosTransform"
export {makeHydrateScenariosTransform, DEFAULT_HYDRATE_FETCHERS} from "./hydrateScenariosTransform"

// Column resolver — declarative, driven by run.data.steps[].type and the
// run's column mappings. Groups columns by source (testset / application /
// evaluator / metrics) so the UI can mirror the screenshot's grouped header
// layout with no name-collision risk across multiple evaluators.
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

// Molecule-backed cache-aware fetchers — all 4 entity types go through
// the entity layer (TanStack cache read, bulk-fetch misses, write-back).
export {
    buildMoleculeBackedFetchers,
    MOLECULE_BACKED_HYDRATE_FETCHERS,
    CACHE_AWARE_HYDRATE_FETCHERS, // @deprecated alias
    cacheAwareFetchTestcases,
    type EntityCacheStats,
    type ChunkCacheStats,
    type BuildMoleculeFetchersOptions,
} from "./cacheAwareFetchers"

// Cache diagnostics — inspect the TanStack cache + atom family sizes
export {
    DEFAULT_DIAGNOSTIC_PREFIXES,
    inspectCache,
    inspectMemory,
    clearCacheByPrefix,
    type CacheDiagnostics,
    type CacheSliceStats,
    type MemorySnapshot,
} from "./cacheDiagnostics"
// Atom family registry — direct access for tests / advanced consumers
export {
    inspectAtomFamilies,
    clearAllAtomFamilies,
    instrumentedAtomFamily,
    type AtomFamilyStats,
    type InstrumentedAtomFamily,
    type InstrumentedAtomFamilyOptions,
} from "../../shared/molecule/instrumentedAtomFamily"

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
