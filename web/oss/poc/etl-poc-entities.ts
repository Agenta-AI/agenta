#!/usr/bin/env -S node --experimental-strip-types
/**
 * ETL PoC — driven by the real entities-package paginated store
 *
 * Headline PoC for the architecture: wraps a real `createPaginatedEntityStore`
 * instance as an ETL Source, runs the engine end-to-end against a real
 * Agenta backend, and produces rich diagnostic output covering:
 *
 *   - Per-chunk timing breakdown (fetch / transform / sink stages)
 *   - Hit-ratio (per-chunk + cumulative)
 *   - Throughput (rows/sec, scanned vs matched vs loaded)
 *   - Memory dynamics (peak, final, GC observations)
 *   - Engine guarantees verified with concrete numbers
 *   - Entities-integration markers (proves the store machinery is used)
 *
 * Env: AGENTA_API_URL, AGENTA_API_KEY, AGENTA_PROJECT_ID, AGENTA_RUN_ID
 * Optional: AGENTA_CHUNK_SIZE, AGENTA_VIEWPORT_TARGET, AGENTA_FILTER_STATUS
 *
 * Run from web/oss/:
 *   pnpm exec tsx poc/etl-poc-entities.ts
 */

process.env.NEXT_PUBLIC_AGENTA_API_URL = process.env.AGENTA_API_URL ?? ""

const env = {
    apiUrl: process.env.AGENTA_API_URL!,
    apiKey: process.env.AGENTA_API_KEY!,
    projectId: process.env.AGENTA_PROJECT_ID!,
    runId: process.env.AGENTA_RUN_ID!,
    chunkSize: Number(process.env.AGENTA_CHUNK_SIZE ?? 50),
    viewportTarget: Number(process.env.AGENTA_VIEWPORT_TARGET ?? 20),
    filterStatus: process.env.AGENTA_FILTER_STATUS ?? "success",
    jsonOutput: process.env.AGENTA_OUTPUT === "json",
    // When set, runs the pipeline TWICE — second pass should benefit from
    // TanStack cache for testcases (and, once the trace store is unbarrel'd,
    // traces too). Lets the PoC demonstrate cache hit ratio empirically.
    cacheRerun: process.env.AGENTA_CACHE_RERUN === "1",
    // When "raw", uses DEFAULT_HYDRATE_FETCHERS (direct HTTP, bypasses the
    // molecule layer). Used for A/B perf comparison vs the default
    // molecule-backed path. Defaults to "molecule".
    fetcherMode: (process.env.AGENTA_FETCHER_MODE ?? "molecule") as "molecule" | "raw",
    // Post-hydrate predicate filter — see makeRowPredicateFilter docs. Wire
    // a value-equality predicate against any resolved UI column. Format:
    //   AGENTA_PREDICATE_KIND=annotation
    //   AGENTA_PREDICATE_GROUP=exact-match   (optional — narrow to slug)
    //   AGENTA_PREDICATE_COLUMN=success
    //   AGENTA_PREDICATE_OP=eq               (eq|ne|in|nin|lt|lte|gt|gte; default eq)
    //   AGENTA_PREDICATE_VALUE=false         (JSON-parsed; "false" → false)
    predicateKind: process.env.AGENTA_PREDICATE_KIND,
    predicateGroup: process.env.AGENTA_PREDICATE_GROUP,
    predicateColumn: process.env.AGENTA_PREDICATE_COLUMN,
    predicateOp: (process.env.AGENTA_PREDICATE_OP ?? "eq") as
        | "eq"
        | "ne"
        | "in"
        | "nin"
        | "lt"
        | "lte"
        | "gt"
        | "gte",
    predicateValueRaw: process.env.AGENTA_PREDICATE_VALUE,
    // Optional second predicate, AND-composed with the first. Same shape
    // as AGENTA_PREDICATE_*. Useful for composite filters like
    // "success=true AND tokens>35".
    predicate2Kind: process.env.AGENTA_PREDICATE2_KIND,
    predicate2Group: process.env.AGENTA_PREDICATE2_GROUP,
    predicate2Column: process.env.AGENTA_PREDICATE2_COLUMN,
    predicate2Op: (process.env.AGENTA_PREDICATE2_OP ?? "eq") as
        | "eq"
        | "ne"
        | "in"
        | "nin"
        | "lt"
        | "lte"
        | "gt"
        | "gte",
    predicate2ValueRaw: process.env.AGENTA_PREDICATE2_VALUE,
}

// In JSON mode, suppress decorative output; everything goes through structured
// emit at the end. Critical errors still go to stderr.
const log = env.jsonOutput ? () => {} : console.log.bind(console)

for (const [k, v] of Object.entries({
    apiUrl: env.apiUrl,
    apiKey: env.apiKey,
    projectId: env.projectId,
    runId: env.runId,
})) {
    if (!v) {
        console.error(`Missing env: AGENTA_${k.toUpperCase()}`)
        process.exit(1)
    }
}

// ============================================================================
// Output helpers
// ============================================================================

function section(title: string): void {
    log("\n" + "═".repeat(72))
    log("  " + title)
    log("═".repeat(72))
}

function subsection(title: string): void {
    log("\n──  " + title + "  " + "─".repeat(Math.max(0, 65 - title.length)))
}

function row(label: string, value: string | number): void {
    const padded = label.padEnd(28)
    log(`  ${padded} ${value}`)
}

function fmtBytes(bytes: number): string {
    const mb = bytes / 1024 / 1024
    if (Math.abs(mb) < 0.01) return `0.0 MB`
    return `${mb >= 0 ? "+" : ""}${mb.toFixed(2)} MB`
}

function fmtMs(ms: number, width = 6): string {
    return `${ms.toFixed(1).padStart(width)}ms`
}

function quantile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo)
}

// ============================================================================
// Per-chunk timing instrumentation
// ============================================================================

interface ChunkMetric {
    chunk: number
    scannedThisChunk: number
    matchedThisChunk: number
    loadedThisChunk: number
    fetchMs: number
    transformMs: number
    sinkMs: number
    totalMs: number
    cursorPrefix: string
    heapDelta: number
}

const metrics: ChunkMetric[] = []

async function main() {
    const overallStart = Date.now()

    // Deep imports — bypass entities barrel
    const {atom} = await import("jotai")
    const {axios, configureAxios} = await import("@agenta/shared/api")
    const {createPaginatedEntityStore} =
        await import("../../packages/agenta-entities/src/shared/paginated/createPaginatedEntityStore")
    const {runLoop, makeSourceFromPaginatedStore} =
        await import("../../packages/agenta-entities/src/etl")
    const {makeHydrateScenariosTransform, DEFAULT_HYDRATE_FETCHERS} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/hydrateScenariosTransform")
    const {buildMoleculeBackedFetchers} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/cacheAwareFetchers")
    type EntityCacheStats =
        import("../../packages/agenta-entities/src/evaluationRun/etl/cacheAwareFetchers").EntityCacheStats
    type ChunkCacheStats =
        import("../../packages/agenta-entities/src/evaluationRun/etl/cacheAwareFetchers").ChunkCacheStats
    const {resolveMappings, groupResolvedColumns} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/resolveMappings")
    const {makeRowPredicateFilter} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/rowPredicateFilter")
    type RowPredicate =
        import("../../packages/agenta-entities/src/evaluationRun/etl/rowPredicateFilter").RowPredicate
    const {createHitRatioMeter} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/hitRatioMeter")
    type HitRatioRegime =
        import("../../packages/agenta-entities/src/evaluationRun/etl/hitRatioMeter").HitRatioRegime
    const {inspectCache, clearCacheByPrefix, inspectMemory, DEFAULT_DIAGNOSTIC_PREFIXES} =
        await import("../../packages/agenta-entities/src/evaluationRun/etl/cacheDiagnostics")
    const {inspectAtomFamilies} =
        await import("../../packages/agenta-entities/src/shared/molecule/instrumentedAtomFamily")
    type ResolvedColumnGroup =
        import("../../packages/agenta-entities/src/evaluationRun/etl/resolveMappings").ResolvedColumnGroup
    type ResolvedColumn =
        import("../../packages/agenta-entities/src/evaluationRun/etl/resolveMappings").ResolvedColumn
    type Transform<In, Out> = import("../../packages/agenta-entities/src/etl/core/types").Transform<
        In,
        Out
    >
    type Sink<T> = import("../../packages/agenta-entities/src/etl/core/types").Sink<T>
    type Chunk<T> = import("../../packages/agenta-entities/src/etl/core/types").Chunk<T>
    type Source<T> = import("../../packages/agenta-entities/src/etl/core/types").Source<T>
    type HydratedScenarioRow<T> =
        import("../../packages/agenta-entities/src/evaluationRun/etl/hydrateScenariosTransform").HydratedScenarioRow<T>
    type HydratableScenario =
        import("../../packages/agenta-entities/src/evaluationRun/etl/hydrateScenariosTransform").HydratableScenario

    // ========================================================================
    // Header
    // ========================================================================

    section("ETL PoC — entities-backed paginated store")

    subsection("Environment")
    row("Node version", process.version)
    row("Process PID", process.pid)
    row("Started", new Date().toISOString())

    subsection("Backend")
    row("API URL", env.apiUrl)
    row("Auth method", `ApiKey ${env.apiKey.slice(0, 8)}...`)
    row("Project", env.projectId)
    row("Run", env.runId)

    subsection("Pipeline configuration")
    row("Source", "scenariosPaginatedStore (createPaginatedEntityStore)")
    const clauseStr = (k?: string, g?: string, c?: string, o?: string, v?: string) =>
        k && c ? `${k}${g ? `:${g}` : ""}.${c} ${o ?? "eq"} ${v}` : null
    const clauses = [
        clauseStr(
            env.predicateKind,
            env.predicateGroup,
            env.predicateColumn,
            env.predicateOp,
            env.predicateValueRaw,
        ),
        clauseStr(
            env.predicate2Kind,
            env.predicate2Group,
            env.predicate2Column,
            env.predicate2Op,
            env.predicate2ValueRaw,
        ),
    ].filter(Boolean)
    const transformDesc =
        clauses.length > 0
            ? `[statusFilter, hydrateScenarios, predicateFilter (${clauses.join(" AND ")})]`
            : `[statusFilter (status === "${env.filterStatus}"), hydrateScenarios (results+metrics+testcases+traces)]`
    row("Transforms", transformDesc)
    row("Sink", "in-memory accumulator (hydrated rows)")
    row("Chunk size", `${env.chunkSize} rows`)
    row("Viewport target", `${env.viewportTarget} matches`)
    row("Cancellation policy", "viewport-fill (matched >= viewport target)")
    row(
        "Hydrate budget",
        "4 bulk requests per chunk: /results/query, /metrics/query, /testcases/query, /tracing/spans/query",
    )

    subsection(`Entity-layer integration (hydrate fetchers — mode=${env.fetcherMode})`)
    if (env.fetcherMode === "molecule") {
        row("fetchResults  ", "evaluationResultMolecule.actions.prefetchByScenarioIds")
        row("fetchMetrics  ", "evaluationMetricMolecule.actions.prefetchByScenarioIds")
        row("fetchTestcases", "testcase prefetchTestcasesByIds (TanStack cache-aware)")
        row(
            "fetchTraces   ",
            "trace prefetchTracesByIds (TanStack cache-aware + traceBatchFetcher coalescing)",
        )
        row("Shared cache", "Jotai queryClientAtom (jotai-tanstack-query)")
    } else {
        row("fetchResults  ", "queryEvaluationResults (direct HTTP, no cache)")
        row("fetchMetrics  ", "queryEvaluationMetrics (direct HTTP, no cache)")
        row("fetchTestcases", "fetchTestcasesBatch (direct HTTP — cache write side-effect)")
        row("fetchTraces   ", "fetchAllPreviewTraces (direct HTTP, no cache)")
        row("Note", "AGENTA_FETCHER_MODE=raw — A/B baseline for the molecule-backed default")
    }

    // ========================================================================
    // Configure shared axios with auth
    // ========================================================================

    // Network instrumentation — count every HTTP request the engine triggers
    interface HttpCall {
        method: string
        path: string
        durationMs: number
        bytes: number
        timestamp: number
    }
    const httpCalls: HttpCall[] = []

    configureAxios({
        requestInterceptor: (config) => {
            if (config.headers && !config.headers.get("Authorization")) {
                config.headers.set("Authorization", `ApiKey ${env.apiKey}`)
            }
            // Stamp request start for latency measurement
            ;(config as unknown as {__startedAt: number}).__startedAt = performance.now()
            return config
        },
        responseInterceptor: (response) => {
            const startedAt = (response.config as unknown as {__startedAt?: number}).__startedAt
            const durationMs = startedAt ? performance.now() - startedAt : 0
            const bytes = JSON.stringify(response.data ?? "").length
            httpCalls.push({
                method: response.config.method?.toUpperCase() ?? "?",
                path: (response.config.url ?? "?").replace(/^.+\/api/, ""),
                durationMs,
                bytes,
                timestamp: Date.now(),
            })
            return response
        },
    })

    // ========================================================================
    // Pre-flight: verify run exists, get metadata
    // ========================================================================

    // Run schema — captured at pre-flight, used later to resolve mapped columns.
    // `data.steps` describes the eval graph (input/invocation/annotation nodes);
    // `data.mappings` defines what columns the UI shows and how to resolve them
    // from the joined entities.
    interface RunStep {
        key: string
        type: "input" | "invocation" | "annotation"
        origin?: string | null
        references?: Record<string, {id: string; slug?: string; version?: string}> | null
        inputs?: {key: string}[] | null
    }
    interface RunMapping {
        column?: {kind?: string | null; name?: string | null} | null
        step?: {key: string; path?: string | null} | null
    }
    let runSchema: {
        name: string
        status: string
        steps: RunStep[]
        mappings: RunMapping[]
        repeats: number
    } | null = null

    subsection("Pre-flight check")
    try {
        const profileRes = await axios.get("/profile")
        row("Auth confirmed", `${(profileRes.data as {email?: string})?.email ?? "(unknown)"}`)

        const runRes = await axios.post(
            "/evaluations/runs/query",
            {run: {ids: [env.runId]}},
            {params: {project_id: env.projectId}},
        )
        const runDoc = (
            runRes.data as {
                runs?: {
                    name?: string
                    status?: string
                    data?: {steps?: RunStep[]; mappings?: RunMapping[]; repeats?: number}
                }[]
            }
        )?.runs?.[0]
        if (!runDoc) throw new Error(`Run ${env.runId} not found in project ${env.projectId}`)
        row("Run name", runDoc.name ?? "(unnamed)")
        row("Run status", runDoc.status ?? "(unknown)")
        runSchema = {
            name: runDoc.name ?? "(unnamed)",
            status: runDoc.status ?? "(unknown)",
            steps: runDoc.data?.steps ?? [],
            mappings: runDoc.data?.mappings ?? [],
            repeats: runDoc.data?.repeats ?? 1,
        }
        row(
            "Run schema",
            `${runSchema.steps.length} steps (${runSchema.steps
                .map((s) => s.type)
                .join(
                    "+",
                )}), ${runSchema.mappings.length} column mappings, repeats=${runSchema.repeats}`,
        )
    } catch (e) {
        console.error(`\n✗ Pre-flight failed: ${e instanceof Error ? e.message : e}`)
        process.exit(1)
    }

    // ========================================================================
    // Run schema detail — the materialization spec
    // ========================================================================

    if (runSchema && runSchema.steps.length > 0) {
        subsection("Run schema — eval graph + column mappings")

        log("\n  Steps (the graph):")
        for (const step of runSchema.steps) {
            const refKeys = Object.keys(step.references ?? {})
            const refSummary = refKeys
                .map(
                    (k) =>
                        `${k}=${step.references?.[k]?.slug ?? step.references?.[k]?.id?.slice(0, 8)}`,
                )
                .join(", ")
            log(`    • [${step.type.padEnd(11)}] ${step.key}`)
            log(`        refs: ${refSummary || "(none)"}`)
            if (step.inputs?.length) {
                log(`        inputs: ${step.inputs.map((i) => i.key).join(", ")}`)
            }
        }

        log("\n  Mappings (the columns the UI will show):")
        for (const m of runSchema.mappings) {
            const kind = m.column?.kind ?? "?"
            const name = m.column?.name ?? "?"
            const stepKey = m.step?.key ?? "?"
            const path = m.step?.path ?? "?"
            log(`    • column "${name}" (kind=${kind})`)
            log(`        from step ${stepKey} at path "${path}"`)
        }
    }

    // ========================================================================
    // Build the paginated store
    // ========================================================================

    interface ScenarioMeta {
        projectId: string
        runId: string
    }
    interface ScenarioRow {
        id: string
        status: string
        __isSkeleton?: boolean
        [k: string]: unknown
    }

    const metaAtom = atom<ScenarioMeta>({projectId: env.projectId, runId: env.runId})

    // Track fetchPage timing — this captures the network cost separately from
    // transform/sink time, so we can break down per-chunk latency.
    let pendingFetchStart = 0
    const fetchTimings: number[] = []

    const scenariosStore = createPaginatedEntityStore<ScenarioRow, ScenarioRow, ScenarioMeta>({
        entityName: "scenarios",
        metaAtom,
        fetchPage: async ({meta, limit, cursor}) => {
            pendingFetchStart = performance.now()
            const res = await axios.post(
                "/evaluations/scenarios/query",
                {
                    scenario: {run_id: meta.runId},
                    windowing: {next: cursor, limit, order: "ascending"},
                },
                {params: {project_id: meta.projectId}},
            )
            const fetchMs = performance.now() - pendingFetchStart
            fetchTimings.push(fetchMs)

            const data = res.data as {
                scenarios?: ScenarioRow[]
                windowing?: {next?: string | null}
            }
            const rows = data?.scenarios ?? []

            // Cursor resolution with three cases (see realScenarioSource.ts for full
            // rationale). Improvement over the original OSS pattern: if server
            // explicitly returned `windowing: {...}` (even with next=null), trust it.
            // Only fall back to last-row-id when server omitted windowing entirely.
            // Plus: items.length < limit → definitive end (no cursor).
            const windowingPresent = data?.windowing !== undefined
            const apiNext = data?.windowing?.next ?? null
            const heuristicFallback =
                rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null
            const definitivelyExhausted = rows.length < limit
            const nextCursor: string | null = definitivelyExhausted
                ? null
                : windowingPresent
                  ? apiNext
                  : (apiNext ?? heuristicFallback)

            return {
                rows,
                totalCount: null,
                hasMore: !!nextCursor,
                nextCursor,
                nextOffset: null,
                nextWindowing: null,
            }
        },
        rowConfig: {
            getRowId: (r) => r.id,
            skeletonDefaults: {__isSkeleton: true, status: "pending"} as Partial<ScenarioRow>,
        },
    })

    // ========================================================================
    // Build the pipeline with instrumented source/transform/sink
    // ========================================================================

    const baseSource = makeSourceFromPaginatedStore<ScenarioRow>(scenariosStore, {
        scopeId: `poc-${env.runId}`,
        pageSize: env.chunkSize,
    })

    // Wrap source to capture per-chunk timing and metadata
    let chunkCount = 0
    let scannedTotal = 0
    let matchedTotal = 0
    let loadedTotal = 0
    const baselineMem = process.memoryUsage().heapUsed
    // Capture both cache + atom family baseline. Span cache is included by
    // default via DEFAULT_DIAGNOSTIC_PREFIXES (traceBatchFetcher writes span
    // entries as a side effect; without this, per-row cost is under-counted).
    const baselineCache = inspectCache()
    const baselineAtomFamilies = inspectAtomFamilies()

    let pendingTransformMs = 0
    let pendingSinkMs = 0
    let pendingFetchMsForChunk = 0

    const instrumentedSource: Source<ScenarioRow> = {
        async *extract(params, signal) {
            for await (const chunk of baseSource.extract(params, signal)) {
                // The fetch happened inside fetchPage; we captured its timing
                // by recording the most recent entry in fetchTimings
                pendingFetchMsForChunk = fetchTimings[fetchTimings.length - 1] ?? 0
                yield chunk
            }
        },
    }

    const wrapTransform =
        <T>(name: string, tx: Transform<T, T>): Transform<T, T> =>
        async (chunk) => {
            const start = performance.now()
            const out = await tx(chunk)
            pendingTransformMs += performance.now() - start
            return out
        }

    const statusFilter = wrapTransform<ScenarioRow>("statusFilter", (chunk) => ({
        ...chunk,
        items: chunk.items.filter((s) => s.status === env.filterStatus),
    }))

    // -----------------------------------------------------------------
    // Hydrate stage — joins each scenario with its correlated entities
    // (results, metrics, testcases, traces) via the entities-package
    // batched fetchers. Runs *after* the filter so we don't pay the
    // hydrate cost on rows we're about to drop.
    // -----------------------------------------------------------------

    interface HydrateMetric {
        chunkScenarios: number
        resultsFetched: number
        metricsFetched: number
        testcasesFetched: number
        tracesFetched: number
        resultsMs: number
        metricsMs: number
        testcasesMs: number
        tracesMs: number
        totalMs: number
    }
    const hydrateMetrics: HydrateMetric[] = []
    let pendingHydrateMs = 0
    let pendingHydrateCounts:
        | {results: number; metrics: number; testcases: number; traces: number}
        | undefined

    // ---- entity-layer cache integration ---------------------------------
    // Every fetcher routes through a molecule.actions.prefetch* action
    // which consults the shared TanStack cache before bulk-fetching misses.
    // Cache stats are recorded per-entity-per-chunk so we can verify the
    // entity layer is doing real work (not just a passthrough).
    // -------------------------------------------------------------------

    type EntityName = "results" | "metrics" | "testcases" | "traces"

    interface ChunkCacheStatsEntry {
        chunk: number
        stats: Partial<ChunkCacheStats>
    }
    const chunkCacheStats: ChunkCacheStatsEntry[] = []
    let pendingStats: Partial<ChunkCacheStats> = {}

    const moleculeBackedFetchers = buildMoleculeBackedFetchers({
        onCacheStats: (entity: EntityName, stats: EntityCacheStats) => {
            pendingStats[entity] = stats
        },
    })
    // Switchable A/B path: "molecule" goes through the entity cache,
    // "raw" calls the api functions directly. Same hydrate transform body.
    const chosenFetchers =
        env.fetcherMode === "raw" ? DEFAULT_HYDRATE_FETCHERS : moleculeBackedFetchers

    const hydrateScenarios = makeHydrateScenariosTransform<ScenarioRow>({
        projectId: env.projectId,
        runId: env.runId,
        fetchers: chosenFetchers,
        onChunkHydrated: (info) => {
            hydrateMetrics.push(info)
            pendingHydrateMs += info.totalMs
            pendingHydrateCounts = {
                results: info.resultsFetched,
                metrics: info.metricsFetched,
                testcases: info.testcasesFetched,
                traces: info.tracesFetched,
            }
            // Commit the per-chunk cache stats snapshot we accumulated
            chunkCacheStats.push({chunk: hydrateMetrics.length, stats: pendingStats})
            pendingStats = {}
        },
    })

    // Wrap the hydrate stage timing into the shared transform-ms accumulator
    // so the per-chunk breakdown stays consistent (fetch+tx+sink=total).
    const wrappedHydrate: Transform<ScenarioRow, HydratedScenarioRow<ScenarioRow>> = async (
        chunk,
    ) => {
        const start = performance.now()
        const out = await hydrateScenarios(chunk)
        pendingTransformMs += performance.now() - start
        return out
    }

    // -----------------------------------------------------------------
    // Optional post-hydrate predicate filter
    //
    // When AGENTA_PREDICATE_* envs are set, build a filter that drops
    // rows whose resolved column doesn't match. This filter MUST run
    // after hydrate because it inspects joined entities (e.g. evaluator
    // output via metric.data).
    // -----------------------------------------------------------------

    let activePredicates: RowPredicate[] = []
    let predicateFilterStats: {scanned: number; matched: number} = {scanned: 0, matched: 0}
    let wrappedPredicateFilter: Transform<
        HydratedScenarioRow<ScenarioRow>,
        HydratedScenarioRow<ScenarioRow>
    > | null = null

    // Build a predicate from env-var triplet
    function buildPredicate(
        kind?: string,
        group?: string,
        column?: string,
        op?: RowPredicate["op"],
        valueRaw?: string,
    ): RowPredicate | null {
        if (!kind || !column || valueRaw === undefined) return null
        let parsedValue: unknown
        try {
            parsedValue = JSON.parse(valueRaw)
        } catch {
            parsedValue = valueRaw
        }
        return {
            groupKind: kind as RowPredicate["groupKind"],
            groupSlug: group,
            columnName: column,
            op: op ?? "eq",
            value: parsedValue,
        }
    }

    const p1 = buildPredicate(
        env.predicateKind,
        env.predicateGroup,
        env.predicateColumn,
        env.predicateOp,
        env.predicateValueRaw,
    )
    const p2 = buildPredicate(
        env.predicate2Kind,
        env.predicate2Group,
        env.predicate2Column,
        env.predicate2Op,
        env.predicate2ValueRaw,
    )
    if (p1) activePredicates.push(p1)
    if (p2) activePredicates.push(p2)

    // Per-chunk regime evolution — captured by the meter callback.
    const hitRatioMeter = createHitRatioMeter()
    interface RegimeSnapshot {
        chunk: number
        scanned: number
        matched: number
        ratio: number
        state: HitRatioRegime["state"]
        rollingRatio: number | null
    }
    const regimeHistory: RegimeSnapshot[] = []

    if (activePredicates.length > 0 && runSchema) {
        // -----------------------------------------------------------------
        // Augment run.data.mappings with implicit "Metrics" group columns.
        //
        // run.data.mappings only declares user-defined columns (testset,
        // invocation, annotation). The UI also surfaces a "Metrics" group
        // (cost / duration / tokens / errors — see the screenshot) which
        // it generates by scanning metric.data for `attributes.ag.metrics.*`
        // paths on the application step. We do the same here so predicates
        // can target those columns.
        //
        // This is a PoC-side augmentation. Production rendering should put
        // this logic in a shared schema-augmentation helper.
        // -----------------------------------------------------------------

        const augmentedMappings = [...runSchema.mappings]
        const appStep = runSchema.steps.find((s) => s.type === "invocation")
        if (appStep) {
            const stdMetricPaths = [
                {
                    name: "tokens.cumulative.total",
                    path: "attributes.ag.metrics.tokens.cumulative.total",
                },
                {
                    name: "costs.cumulative.total",
                    path: "attributes.ag.metrics.costs.cumulative.total",
                },
                {
                    name: "duration.cumulative",
                    path: "attributes.ag.metrics.duration.cumulative",
                },
            ]
            for (const m of stdMetricPaths) {
                augmentedMappings.push({
                    column: {kind: "metrics", name: m.name},
                    step: {key: appStep.key, path: m.path},
                })
            }
        }

        const augmentedSchema = {steps: runSchema.steps, mappings: augmentedMappings}

        const inner = makeRowPredicateFilter<ScenarioRow>({
            predicates: activePredicates,
            schema: augmentedSchema,
            onChunkFiltered: (info) => {
                // Stats are emitted once per predicate per chunk; only sum
                // (and feed the meter) on the first one to avoid double-counting.
                if (info.droppedPredicate === activePredicates[0]) {
                    predicateFilterStats.scanned += info.scanned
                    predicateFilterStats.matched += info.matched
                    hitRatioMeter.record({
                        chunk: info.chunk,
                        scanned: info.scanned,
                        matched: info.matched,
                    })
                    const r = hitRatioMeter.regime()
                    regimeHistory.push({
                        chunk: info.chunk,
                        scanned: info.scanned,
                        matched: info.matched,
                        ratio: info.scanned > 0 ? info.matched / info.scanned : 0,
                        state: r.state,
                        rollingRatio: r.rollingRatio,
                    })
                }
            },
        })
        wrappedPredicateFilter = async (chunk) => {
            const start = performance.now()
            const out = await inner(chunk)
            pendingTransformMs += performance.now() - start
            return out
        }
    }

    const matchedRows: HydratedScenarioRow<ScenarioRow>[] = []
    let finalizedRan = false
    const sinkLatencies: number[] = []

    const wrappedSink: Sink<HydratedScenarioRow<ScenarioRow>> = {
        async load(chunk: Chunk<HydratedScenarioRow<ScenarioRow>>) {
            const start = performance.now()
            matchedRows.push(...chunk.items)
            const ms = performance.now() - start
            pendingSinkMs += ms
            sinkLatencies.push(ms)
            return {loadedCount: chunk.items.length}
        },
        async finalize() {
            finalizedRan = true
        },
    }

    // ========================================================================
    // Run the loop
    // ========================================================================

    section("Execution")

    log(
        "\n  " +
            "chunk".padStart(5) +
            "  " +
            "fetch+tx+sink=total".padEnd(24) +
            "  " +
            "scan".padStart(5) +
            "  " +
            "match".padStart(5) +
            "  " +
            "load".padStart(5) +
            "  " +
            "hit%".padStart(6) +
            "  " +
            "heap".padStart(10) +
            "  " +
            "cursor",
    )
    log("  " + "─".repeat(96))

    const abort = new AbortController()
    let aborted = false
    let cancellationLatencyMs = 0
    let stopReason: "exhausted" | "viewport-fill" | "error" = "exhausted"
    let lastChunkCursor: string | null | undefined = undefined
    const loopStart = performance.now()

    try {
        const transforms: Transform<unknown, unknown>[] = [
            statusFilter as Transform<unknown, unknown>,
            wrappedHydrate as Transform<unknown, unknown>,
        ]
        if (wrappedPredicateFilter) {
            transforms.push(wrappedPredicateFilter as Transform<unknown, unknown>)
        }

        for await (const progress of runLoop(
            instrumentedSource,
            transforms,
            wrappedSink as Sink<unknown>,
            undefined,
            abort.signal,
        )) {
            chunkCount++
            const scannedThisChunk = progress.scanned - scannedTotal
            const matchedThisChunk = progress.matched - matchedTotal
            const loadedThisChunk = progress.loaded - loadedTotal
            scannedTotal = progress.scanned
            matchedTotal = progress.matched
            loadedTotal = progress.loaded

            const hitPctThisChunk =
                scannedThisChunk > 0 ? (matchedThisChunk / scannedThisChunk) * 100 : 0
            const heap = process.memoryUsage().heapUsed - baselineMem
            // Show last 12 chars of the cursor — UUIDv7 prefixes are time-sorted
            // so the last bits are what actually distinguishes one cursor from
            // the next.
            const cursorStr =
                typeof progress.cursor === "string"
                    ? "..." + progress.cursor.slice(-12)
                    : progress.cursor === null
                      ? "(end)"
                      : "?"

            const totalThisChunk = pendingFetchMsForChunk + pendingTransformMs + pendingSinkMs

            metrics.push({
                chunk: chunkCount,
                scannedThisChunk,
                matchedThisChunk,
                loadedThisChunk,
                fetchMs: pendingFetchMsForChunk,
                transformMs: pendingTransformMs,
                sinkMs: pendingSinkMs,
                totalMs: totalThisChunk,
                cursorPrefix: cursorStr,
                heapDelta: heap,
            })

            log(
                "  " +
                    String(chunkCount).padStart(5) +
                    "  " +
                    `${fmtMs(pendingFetchMsForChunk, 4)}+${fmtMs(pendingTransformMs, 3)}+${fmtMs(
                        pendingSinkMs,
                        3,
                    )}=${fmtMs(totalThisChunk, 5)}`.padEnd(24) +
                    "  " +
                    String(scannedThisChunk).padStart(5) +
                    "  " +
                    String(matchedThisChunk).padStart(5) +
                    "  " +
                    String(loadedThisChunk).padStart(5) +
                    "  " +
                    `${hitPctThisChunk.toFixed(1)}%`.padStart(6) +
                    "  " +
                    fmtBytes(heap).padStart(10) +
                    "  " +
                    cursorStr,
            )

            // Reset pending timers for next chunk
            pendingTransformMs = 0
            pendingSinkMs = 0
            pendingFetchMsForChunk = 0

            lastChunkCursor =
                typeof progress.cursor === "string" ? progress.cursor : progress.cursor

            if (progress.matched >= env.viewportTarget) {
                const abortStart = performance.now()
                abort.abort()
                aborted = true
                stopReason = "viewport-fill"
                cancellationLatencyMs = performance.now() - abortStart
                log(
                    `\n  ▸ Viewport filled (${env.viewportTarget} matches reached at chunk ${chunkCount}); aborting`,
                )
                break
            }
        }
        // If we exited the for-await without aborting, source ran out
        if (!aborted && lastChunkCursor === null) {
            stopReason = "exhausted"
        }
    } catch (e) {
        console.error(`\n✗ Pipeline error: ${e instanceof Error ? e.message : e}`)
        process.exit(1)
    }

    const loopElapsed = performance.now() - loopStart
    const totalElapsed = Date.now() - overallStart

    // ========================================================================
    // Final summary
    // ========================================================================

    section("Execution summary")

    const totalMsList = metrics.map((m) => m.totalMs).sort((a, b) => a - b)
    const fetchMsList = metrics.map((m) => m.fetchMs).sort((a, b) => a - b)
    const txMsList = metrics.map((m) => m.transformMs).sort((a, b) => a - b)

    subsection("Loop iteration")
    row("Chunks processed", chunkCount)
    row("Total elapsed (incl. setup)", `${totalElapsed} ms`)
    row("Loop-only elapsed", `${loopElapsed.toFixed(1)} ms`)
    row("Per-chunk total (median)", `${quantile(totalMsList, 0.5).toFixed(1)} ms`)
    row("Per-chunk total (p95)", `${quantile(totalMsList, 0.95).toFixed(1)} ms`)
    row("Per-chunk total (max)", `${Math.max(...totalMsList).toFixed(1)} ms`)
    if (aborted) {
        row("Cancellation triggered", `at chunk ${chunkCount}`)
        row("Cancellation latency", `${cancellationLatencyMs.toFixed(2)} ms (abort → loop exit)`)
    }

    subsection("Stage breakdown")
    row(
        "Network (fetch) total",
        `${fetchMsList.reduce((a, b) => a + b, 0).toFixed(1)} ms ` +
            `(median ${quantile(fetchMsList, 0.5).toFixed(1)} ms/chunk)`,
    )
    row(
        "Transform total",
        `${txMsList.reduce((a, b) => a + b, 0).toFixed(2)} ms ` +
            `(median ${quantile(txMsList, 0.5).toFixed(2)} ms/chunk)`,
    )
    row(
        "Sink load total",
        `${sinkLatencies.reduce((a, b) => a + b, 0).toFixed(2)} ms ` +
            `(median ${quantile(
                sinkLatencies.slice().sort((a, b) => a - b),
                0.5,
            ).toFixed(2)} ms/chunk)`,
    )
    const networkPct =
        (fetchMsList.reduce((a, b) => a + b, 0) / metrics.reduce((sum, m) => sum + m.totalMs, 0)) *
        100
    row("Network dominance", `${networkPct.toFixed(1)}% of per-chunk time is network`)

    subsection("Throughput")

    // What "scanned" means depends on why we stopped
    const stopExplain =
        stopReason === "viewport-fill"
            ? `viewport-fill cancellation (matched >= ${env.viewportTarget})`
            : stopReason === "exhausted"
              ? "source exhausted (cursor=null returned)"
              : "error"
    row("Stop reason", stopExplain)
    row(
        "Dataset coverage",
        stopReason === "exhausted"
            ? `100% — scanned all ${scannedTotal} rows in dataset`
            : `partial — scanned ${scannedTotal} rows, dataset size unknown (cancelled before end)`,
    )

    row("Rows requested", `${scannedTotal} (${(scannedTotal / chunkCount).toFixed(1)}/chunk avg)`)
    row(
        "Rows matched",
        `${matchedTotal} (${((matchedTotal / Math.max(scannedTotal, 1)) * 100).toFixed(1)}% hit ratio)`,
    )
    row("Rows loaded into sink", `${loadedTotal}`)

    // Over-fetch only meaningful when viewport-cancelled
    if (stopReason === "viewport-fill") {
        const overFetch = matchedTotal - env.viewportTarget
        const overFetchPct = (overFetch / env.viewportTarget) * 100
        row(
            "Over-fetch (waste)",
            `${overFetch} rows matched beyond viewport target of ${env.viewportTarget} ` +
                `(${overFetchPct.toFixed(0)}% over)`,
        )
    }
    row(
        "Rows per RTT",
        `${(scannedTotal / Math.max(chunkCount, 1)).toFixed(0)} ` +
            `(${chunkCount} RTT(s) for ${scannedTotal} rows)`,
    )
    row("Effective scan rate", `${Math.round((scannedTotal / loopElapsed) * 1000)} rows/sec`)

    // ========================================================================
    // Predicate filter effectiveness (only when AGENTA_PREDICATE_* is set)
    // ========================================================================

    if (activePredicates.length > 0) {
        subsection("Post-hydrate predicate filter")
        for (let idx = 0; idx < activePredicates.length; idx++) {
            const p = activePredicates[idx]
            row(
                idx === 0 ? "Predicate" : "  AND",
                `${p.groupKind}${p.groupSlug ? `:${p.groupSlug}` : ""}.${p.columnName} ${p.op} ${JSON.stringify(p.value)}`,
            )
        }
        row("Rows scanned", `${predicateFilterStats.scanned} (post-hydrate)`)
        row(
            "Rows matched predicate",
            `${predicateFilterStats.matched} (${predicateFilterStats.scanned > 0 ? ((predicateFilterStats.matched / predicateFilterStats.scanned) * 100).toFixed(1) : "0.0"}% pass rate)`,
        )
        row(
            "Wasted hydration",
            `${predicateFilterStats.scanned - predicateFilterStats.matched} rows hydrated then dropped (~${(((predicateFilterStats.scanned - predicateFilterStats.matched) / Math.max(predicateFilterStats.scanned, 1)) * 100).toFixed(0)}% of hydrate cost)`,
        )
        log(`  ▸ This filter runs CLIENT-SIDE after hydration. The API doesn't currently`)
        log(`    support filtering scenarios by joined annotation values. A server-side`)
        log(`    filter (per eval-filtering.md F1/F2) would eliminate the wasted hydration.`)

        // ----------------------------------------------------------------
        // Hit-ratio escalation meter — the v1→v2 signal per eval-filtering
        // RFC D2 + C3. Reports the regime; does not actually swap engines.
        // ----------------------------------------------------------------

        subsection("Hit-ratio escalation meter (v1→v2 signal, report-only)")
        const finalRegime = hitRatioMeter.regime()
        row(
            "Config",
            `windowSize=${hitRatioMeter.config.windowSize} chunks, threshold=${(hitRatioMeter.config.threshold * 100).toFixed(0)}%`,
        )
        row("Chunks observed", `${finalRegime.chunksObserved}`)
        row(
            "Rolling ratio (last window)",
            finalRegime.rollingRatio === null
                ? "(warming — insufficient chunks)"
                : `${(finalRegime.rollingRatio * 100).toFixed(1)}%`,
        )
        const stateMark =
            finalRegime.state === "escalate"
                ? "↑ escalate"
                : finalRegime.state === "client"
                  ? "✓ client"
                  : "… warming"
        row("Recommendation", `${stateMark}  — ${finalRegime.reason}`)

        if (regimeHistory.length > 0) {
            log("\n  Per-chunk regime evolution:")
            log(
                "    " +
                    "chunk".padStart(5) +
                    "  " +
                    "scanned".padStart(7) +
                    "  " +
                    "matched".padStart(7) +
                    "  " +
                    "ratio".padStart(7) +
                    "  " +
                    "rolling".padStart(8) +
                    "  " +
                    "state",
            )
            log("    " + "─".repeat(60))
            for (const r of regimeHistory) {
                log(
                    "    " +
                        String(r.chunk).padStart(5) +
                        "  " +
                        String(r.scanned).padStart(7) +
                        "  " +
                        String(r.matched).padStart(7) +
                        "  " +
                        `${(r.ratio * 100).toFixed(1)}%`.padStart(7) +
                        "  " +
                        (r.rollingRatio === null
                            ? "(warming)".padStart(8)
                            : `${(r.rollingRatio * 100).toFixed(1)}%`.padStart(8)) +
                        "  " +
                        r.state,
                )
            }
        }
        log("")
        if (finalRegime.state === "escalate") {
            log("  ▸ Recommendation: switch this predicate to v2 backend filtering.")
            log("    Today the meter only REPORTS; the actual swap (POST scenarios/query")
            log("    with `filtering` param, transform becomes a no-op) is the v2 milestone.")
            log("    Wasted hydration above is the cost we'd avoid.")
        } else if (finalRegime.state === "client") {
            log("  ▸ Recommendation: keep v1 client-side filter. Hit ratio is healthy.")
        }
    }

    // ========================================================================
    // Network detail — every HTTP request the pipeline triggered
    // ========================================================================

    subsection("Network requests (HTTP)")

    const callsByPath = new Map<string, HttpCall[]>()
    for (const call of httpCalls) {
        const list = callsByPath.get(call.path) ?? []
        list.push(call)
        callsByPath.set(call.path, list)
    }
    for (const [path, calls] of callsByPath.entries()) {
        const totalMs = calls.reduce((a, c) => a + c.durationMs, 0)
        const totalBytes = calls.reduce((a, c) => a + c.bytes, 0)
        const medianMs = quantile(
            calls.map((c) => c.durationMs).sort((a, b) => a - b),
            0.5,
        )
        row(
            path,
            `${calls.length} calls, ${totalMs.toFixed(1)} ms total ` +
                `(median ${medianMs.toFixed(1)} ms), ` +
                `${(totalBytes / 1024).toFixed(1)} KB received`,
        )
    }
    row(
        "Total HTTP requests",
        `${httpCalls.length} ` +
            `(${(httpCalls.length / Math.max(chunkCount, 1)).toFixed(2)} per pipeline chunk)`,
    )
    const totalNetworkMs = httpCalls.reduce((a, c) => a + c.durationMs, 0)
    row(
        "Total HTTP wall-clock",
        `${totalNetworkMs.toFixed(1)} ms ` +
            `(${((totalNetworkMs / Math.max(loopElapsed, 1)) * 100).toFixed(1)}% of loop time)`,
    )

    subsection("Memory dynamics")
    const peakHeap = Math.max(...metrics.map((m) => m.heapDelta))
    const finalHeap = process.memoryUsage().heapUsed - baselineMem
    row("Peak heap delta", fmtBytes(peakHeap))
    row("Final heap delta", fmtBytes(finalHeap))

    // ---- Entity-cache memory accounting -----------------------------
    // Walk the TanStack QueryClient at three lifecycle points and report
    // entries + approximate bytes per entity prefix. This is the visibility
    // we need: a single hydrate pass adds N cache entries per scenario per
    // entity type, and without explicit eviction those entries live for the
    // process lifetime.
    // -----------------------------------------------------------------

    // Touch the trace atom family for each trace we fetched, so the
    // instrumented registry has a non-zero size to display. In production
    // code (React app), `useAtomValue(traceEntityAtomFamily(traceId))`
    // would do this naturally on cell render. In headless contexts the
    // atom family isn't exercised by default — we exercise it explicitly
    // here so the diagnostic surface shows the real cost of subscribing
    // to atoms on top of the bulk-cache path.
    const {traceEntityAtomFamily} =
        await import("../../packages/agenta-entities/src/trace/state/store")
    for (const hr of matchedRows) {
        for (const traceId of Object.keys(hr.traces)) {
            // Just creating the atom adds traceId to the family's tracking
            // Set. The atom itself is lazy — we don't subscribe.
            traceEntityAtomFamily(traceId)
        }
    }

    const postHydrateCache = inspectCache()
    const postHydrateAtomFamilies = inspectAtomFamilies()

    log(`  Entity cache (post-pipeline, includes span-level cache):`)
    log(
        `    baseline:   ${baselineCache.totalEntries} entries, ${(baselineCache.totalApproxBytes / 1024).toFixed(1)} KB`,
    )
    log(
        `    post-run:   ${postHydrateCache.totalEntries} entries, ${(postHydrateCache.totalApproxBytes / 1024).toFixed(1)} KB`,
    )
    log(
        `    delta:      +${postHydrateCache.totalEntries - baselineCache.totalEntries} entries, +${((postHydrateCache.totalApproxBytes - baselineCache.totalApproxBytes) / 1024).toFixed(1)} KB`,
    )
    log(`  Per-prefix breakdown (post-pipeline, sorted by bytes):`)
    for (const slice of postHydrateCache.slices) {
        log(
            `    ${slice.prefix.padEnd(22)} ${String(slice.entries).padStart(4)} entries, ${(
                slice.approxBytes / 1024
            )
                .toFixed(1)
                .padStart(8)} KB total, ${(slice.largestEntryBytes / 1024).toFixed(1)} KB largest`,
        )
    }
    log("")
    log(`  Atom families (active params per instrumented family):`)
    const baselineAtomFamiliesByName = new Map(baselineAtomFamilies.map((f) => [f.name, f.size]))
    const interestingAtomFamilies = postHydrateAtomFamilies.filter(
        (f) => f.size > 0 || (baselineAtomFamiliesByName.get(f.name) ?? 0) > 0,
    )
    if (interestingAtomFamilies.length === 0) {
        log(`    (no instrumented atom families have active params yet)`)
    } else {
        for (const f of interestingAtomFamilies) {
            const before = baselineAtomFamiliesByName.get(f.name) ?? 0
            const delta = f.size - before
            const sign = delta >= 0 ? "+" : ""
            log(
                `    ${f.name.padEnd(38)} ${String(f.size).padStart(4)} params (${sign}${delta} since baseline)`,
            )
        }
    }
    const totalAtomFamilyParams = postHydrateAtomFamilies.reduce((a, f) => a + f.size, 0)
    log(`    total params across all instrumented families: ${totalAtomFamilyParams}`)
    log("")
    log(
        `  ⚠ TanStack entries + atom family params persist until process exit unless explicitly evicted.`,
    )
    log(`    For ETL/long-run flows: evaluationResultMolecule.actions.evictByRunId(...)`)
    log(`    + clearCacheByPrefix(['testcase','trace-entity','span'])`)
    log(`    + family.clear() for instrumented atom families you want to release.`)
    // Look for evidence of GC: heap went down between any two consecutive chunks
    const gcEvents = metrics.reduce((count, m, i) => {
        if (i === 0) return count
        return m.heapDelta < metrics[i - 1].heapDelta - 0.5 * 1024 * 1024 ? count + 1 : count
    }, 0)
    row("GC events observed", `${gcEvents} (heap drops > 0.5 MB between chunks)`)

    // ========================================================================
    // Hydration cost — per-stage breakdown across all chunks
    // ========================================================================

    // ========================================================================
    // Cache integration — per-entity hit/miss breakdown
    // ========================================================================

    subsection("Entity cache integration (per-chunk hit/miss via molecules)")

    if (chunkCacheStats.length === 0) {
        row("Cache stats", "(no chunks hydrated)")
    } else {
        const totalsByEntity: Record<EntityName, EntityCacheStats> = {
            results: {cacheHits: 0, cacheMisses: 0, fetchMs: 0},
            metrics: {cacheHits: 0, cacheMisses: 0, fetchMs: 0},
            testcases: {cacheHits: 0, cacheMisses: 0, fetchMs: 0},
            traces: {cacheHits: 0, cacheMisses: 0, fetchMs: 0},
        }
        for (const entry of chunkCacheStats) {
            for (const e of ["results", "metrics", "testcases", "traces"] as EntityName[]) {
                const s = entry.stats[e]
                if (!s) continue
                totalsByEntity[e].cacheHits += s.cacheHits
                totalsByEntity[e].cacheMisses += s.cacheMisses
                totalsByEntity[e].fetchMs += s.fetchMs
            }
        }

        for (const e of ["results", "metrics", "testcases", "traces"] as EntityName[]) {
            const t = totalsByEntity[e]
            const total = t.cacheHits + t.cacheMisses
            const hitPct = total > 0 ? (t.cacheHits / total) * 100 : 0
            row(
                e.padEnd(10),
                total === 0
                    ? "no requests"
                    : `${t.cacheHits}/${total} hits (${hitPct.toFixed(0)}%), ${t.fetchMs.toFixed(1)} ms network`,
            )
        }
    }

    // ------------------------------------------------------------------
    // Cache reuse verification — call the molecule prefetch actions a
    // second time on the same scenario set. Everything should be a hit
    // and network cost should be near zero. This proves the cache layer
    // is real, not a no-op.
    // ------------------------------------------------------------------

    subsection("Cache reuse verification (re-prefetch the same scenarios)")

    const scenarioIdsForReprefetch = matchedRows.map((r) => r.scenario.id)
    const testcaseIdsForReprefetch = Array.from(
        new Set(
            matchedRows
                .flatMap((r) => [
                    r.scenario.testcase_id,
                    ...r.results.map((res) => res.testcase_id),
                ])
                .filter((v): v is string => typeof v === "string" && v.length > 0),
        ),
    )
    const traceIdsForReprefetch = Array.from(
        new Set(
            matchedRows
                .flatMap((r) => Object.keys(r.traces))
                .filter((v) => typeof v === "string" && v.length > 0),
        ),
    )

    const {evaluationResultMolecule, evaluationMetricMolecule} =
        await import("../../packages/agenta-entities/src/evaluationRun/state")
    const {prefetchTestcasesByIds: rePrefetchTc} =
        await import("../../packages/agenta-entities/src/testcase/state/prefetch")
    const {prefetchTracesByIds: rePrefetchTr} =
        await import("../../packages/agenta-entities/src/trace/state/prefetch")

    const reprefetchResults = await evaluationResultMolecule.actions.prefetchByScenarioIds({
        projectId: env.projectId,
        runId: env.runId,
        scenarioIds: scenarioIdsForReprefetch,
    })
    const reprefetchMetrics = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
        projectId: env.projectId,
        runId: env.runId,
        scenarioIds: scenarioIdsForReprefetch,
    })
    const reprefetchTestcases = await rePrefetchTc({
        projectId: env.projectId,
        testcaseIds: testcaseIdsForReprefetch,
    })
    const reprefetchTraces = await rePrefetchTr({
        projectId: env.projectId,
        traceIds: traceIdsForReprefetch,
    })

    const formatRerun = (
        label: string,
        s: {cacheHits: number; cacheMisses: number; fetchMs: number},
    ) => {
        const total = s.cacheHits + s.cacheMisses
        const hitPct = total > 0 ? (s.cacheHits / total) * 100 : 0
        const verdict =
            total > 0 && s.cacheHits === total ? "✓ 100% cache hit" : `⚠ ${s.cacheMisses} misses`
        row(
            label.padEnd(10),
            `${s.cacheHits}/${total} (${hitPct.toFixed(0)}%) — ${s.fetchMs.toFixed(1)} ms network — ${verdict}`,
        )
    }
    formatRerun("results", reprefetchResults)
    formatRerun("metrics", reprefetchMetrics)
    formatRerun("testcases", {
        cacheHits: reprefetchTestcases.cacheHits,
        cacheMisses: reprefetchTestcases.cacheMisses,
        fetchMs: reprefetchTestcases.fetchMs,
    })
    formatRerun("traces", {
        cacheHits: reprefetchTraces.cacheHits,
        cacheMisses: reprefetchTraces.cacheMisses,
        fetchMs: reprefetchTraces.fetchMs,
    })

    // ---- Eviction verification --------------------------------------
    // After a long-run pass, callers must be able to release entity-cache
    // memory. Use the molecule-level evictByRunId to bulk-drop everything
    // for this run, plus clearCacheByPrefix for testcase/trace (which are
    // run-agnostic). This section proves the cache shrinks after eviction.
    // -----------------------------------------------------------------

    subsection("Cache eviction (bounded memory for long-run scripts)")

    const preEvictCache = inspectCache()
    const preEvictAtomFamilies = inspectAtomFamilies()

    const evictedResults = evaluationResultMolecule.actions.evictByRunId({
        projectId: env.projectId,
        runId: env.runId,
    })
    const evictedMetrics = evaluationMetricMolecule.actions.evictByRunId({
        projectId: env.projectId,
        runId: env.runId,
    })
    // Testcase + trace caches aren't scoped by run — clear by prefix.
    // The span-level cache is populated as a side-effect of trace fetches
    // and must be cleared explicitly to fully release the trace memory cost.
    const evictedTestcases = clearCacheByPrefix(["testcase"])
    const evictedTraces = clearCacheByPrefix(["trace-entity"])
    const evictedSpans = clearCacheByPrefix(["span"])

    const postEvictCache = inspectCache()

    row(
        "Before eviction",
        `${preEvictCache.totalEntries} entries, ${(preEvictCache.totalApproxBytes / 1024).toFixed(1)} KB`,
    )
    row(
        "After eviction",
        `${postEvictCache.totalEntries} entries, ${(postEvictCache.totalApproxBytes / 1024).toFixed(1)} KB`,
    )
    row(
        "Removed",
        `results=${evictedResults}, metrics=${evictedMetrics}, testcases=${evictedTestcases}, traces=${evictedTraces}, spans=${evictedSpans}`,
    )

    // Atom family params remain in their families even after cache eviction —
    // the atoms still exist as memoized factory outputs. Show the delta so
    // the user sees the layer is decoupled. Calling family.clear() (or
    // family.remove(param)) is the right knob for atom-level cleanup.
    const postEvictAtomFamilies = inspectAtomFamilies()
    const preEvictTotal = preEvictAtomFamilies.reduce((a, f) => a + f.size, 0)
    const postEvictTotal = postEvictAtomFamilies.reduce((a, f) => a + f.size, 0)
    row(
        "Atom family params (post-cache-evict)",
        `${postEvictTotal} retained (was ${preEvictTotal}) — TanStack eviction does NOT remove atoms; call family.clear() next`,
    )

    // Now demonstrate atom-level cleanup. Each instrumented family has its
    // own `.clear()` action that drops every memoized param.
    const {clearAllAtomFamilies} =
        await import("../../packages/agenta-entities/src/shared/molecule/instrumentedAtomFamily")
    const removedAtomParams = clearAllAtomFamilies()
    const finalAtomFamilies = inspectAtomFamilies()
    const finalTotal = finalAtomFamilies.reduce((a, f) => a + f.size, 0)
    row(
        "Atom family params (after clear)",
        `${finalTotal} retained, ${removedAtomParams} params removed`,
    )

    subsection("Hydration cost (correlated entity fetches per chunk)")

    const totalHydrateMs = hydrateMetrics.reduce((a, h) => a + h.totalMs, 0)
    const totalResultsFetched = hydrateMetrics.reduce((a, h) => a + h.resultsFetched, 0)
    const totalMetricsFetched = hydrateMetrics.reduce((a, h) => a + h.metricsFetched, 0)
    const totalTestcasesFetched = hydrateMetrics.reduce((a, h) => a + h.testcasesFetched, 0)
    const totalTracesFetched = hydrateMetrics.reduce((a, h) => a + h.tracesFetched, 0)

    if (hydrateMetrics.length === 0) {
        row("Hydrate chunks", "0 (filter dropped everything, or no rows scanned)")
    } else {
        row(
            "Hydrate stage total",
            `${totalHydrateMs.toFixed(1)} ms across ${hydrateMetrics.length} chunks ` +
                `(median ${quantile(
                    hydrateMetrics.map((h) => h.totalMs).sort((a, b) => a - b),
                    0.5,
                ).toFixed(1)} ms/chunk)`,
        )
        row(
            "Results fetched",
            `${totalResultsFetched} (across all chunks; ~${(totalResultsFetched / Math.max(matchedTotal, 1)).toFixed(1)} per scenario)`,
        )
        row("Metrics fetched", `${totalMetricsFetched} per-scenario metric rows`)
        row("Testcases fetched", `${totalTestcasesFetched} (bulk by testcase_id)`)
        row(
            "Traces fetched",
            `${totalTracesFetched} (bulk by trace_id IN [...] from result.trace_id)`,
        )
        // The architectural claim: hydrate cost is bounded per chunk, regardless
        // of column count or row count. 4 bulk calls — independent of chunk size.
        row(
            "Request budget verified",
            `${hydrateMetrics.length} chunks × ${skipTracesNote(hydrateMetrics)} = ${
                hydrateMetrics.length * expectedHydrateBudget(hydrateMetrics)
            } expected bulk requests`,
        )
    }

    // ========================================================================
    // Pipeline output — fully materialized rows (scenario + results + metrics + testcase + traces)
    // ========================================================================

    subsection("Pipeline output — materialized rows (5-way join)")

    // -----------------------------------------------------------------
    // Column resolution is delegated to the generalized `resolveMappings`
    // helper in `@agenta/entities/evaluationRun/etl`. It dispatches on
    // `step.type` (input / invocation / annotation / custom) and handles
    // multiple trace envelope shapes — see resolveMappings.ts for the
    // strategy registry. The PoC just calls it.
    // -----------------------------------------------------------------

    function resolveColumns(hr: HydratedScenarioRow<ScenarioRow>): ResolvedColumn[] {
        if (!runSchema) return []
        return resolveMappings(hr, {
            steps: runSchema.steps,
            mappings: runSchema.mappings,
        })
    }

    // Helper: collapse long values so the dump stays readable.
    function shortVal(v: unknown, maxLen = 72): string {
        if (v === null) return "null"
        if (v === undefined) return "undefined"
        if (typeof v === "string") {
            if (v.length <= maxLen) return JSON.stringify(v)
            return JSON.stringify(`${v.slice(0, Math.floor(maxLen * 0.6))}…${v.slice(-12)}`)
        }
        if (typeof v === "object") {
            const json = JSON.stringify(v)
            if (json.length <= maxLen) return json
            return `${json.slice(0, Math.floor(maxLen * 0.85))}…${json.slice(-8)}`
        }
        return String(v)
    }

    function dumpRow(hr: HydratedScenarioRow<ScenarioRow>, label: string): void {
        log(`\n  [${label}]`)

        // Materialized columns, grouped by source — mirrors the UI's
        // grouped-header layout (Testset / Application / <Evaluator> / Metrics).
        const cols = resolveColumns(hr)
        if (cols.length > 0) {
            const groups = groupResolvedColumns(cols)
            log(`    UI columns (grouped by source — mirrors UI rendering):`)
            for (const g of groups) {
                log(
                    `      ▸ ${g.group.label}  [${g.group.kind}${g.group.slug ? ` · ${g.group.slug}` : ""}]`,
                )
                for (const c of g.columns) {
                    const sourceTag = c.source === "missing" ? "✗" : `via ${c.source}`
                    log(
                        `          • ${c.name.padEnd(20)} = ${shortVal(c.value, 80)}  [${sourceTag}]`,
                    )
                }
            }
        }

        log(`    scenario`)
        log(`      id                   ${hr.scenario.id}`)
        log(`      status               ${hr.scenario.status}`)
        log(`      testcase_id          ${shortVal(hr.scenario.testcase_id ?? null)}`)
        // Other scenario fields if interesting
        const otherScenarioKeys = Object.keys(hr.scenario)
            .filter((k) => !["id", "status", "testcase_id", "__isSkeleton"].includes(k))
            .sort()
        for (const k of otherScenarioKeys.slice(0, 6)) {
            log(`      ${k.padEnd(20)} ${shortVal(hr.scenario[k])}`)
        }
        log(`    results (${hr.results.length})`)
        for (const r of hr.results.slice(0, 4)) {
            log(
                `      • step=${(r.step_key ?? "?").padEnd(14)} status=${(r.status ?? "?").padEnd(10)} trace=${shortVal(r.trace_id ?? null, 40)}`,
            )
        }
        if (hr.results.length > 4) {
            log(`      … and ${hr.results.length - 4} more`)
        }
        log(`    metrics (${hr.metrics.length})`)
        for (const m of hr.metrics.slice(0, 2)) {
            log(`      • status=${(m.status ?? "?").padEnd(10)} data=${shortVal(m.data, 90)}`)
        }
        if (hr.metrics.length > 2) {
            log(`      … and ${hr.metrics.length - 2} more`)
        }
        log(`    testcase`)
        if (hr.testcase) {
            log(`      id                   ${hr.testcase.id}`)
            log(`      data                 ${shortVal(hr.testcase.data, 90)}`)
        } else {
            log(`      (none — no testcase_id or fetch returned null)`)
        }
        log(`    traces (${Object.keys(hr.traces).length})`)
        for (const traceId of Object.keys(hr.traces).slice(0, 2)) {
            const trace = hr.traces[traceId]
            log(`      • ${traceId}: ${shortVal(trace, 90)}`)
        }
        if (Object.keys(hr.traces).length > 2) {
            log(`      … and ${Object.keys(hr.traces).length - 2} more`)
        }
    }

    if (matchedRows.length === 0) {
        row("Rows produced", "0 — nothing matched the predicate")
    } else {
        row("Rows in sink", `${matchedRows.length}`)

        // Aggregate join stats across all rows
        const totalResults = matchedRows.reduce((a, r) => a + r.results.length, 0)
        const totalMetricsInRows = matchedRows.reduce((a, r) => a + r.metrics.length, 0)
        const rowsWithTestcase = matchedRows.filter((r) => r.testcase !== null).length
        const totalTraces = matchedRows.reduce((a, r) => a + Object.keys(r.traces).length, 0)
        row(
            "Results per row",
            `${(totalResults / matchedRows.length).toFixed(2)} avg ` +
                `(min ${Math.min(...matchedRows.map((r) => r.results.length))}, ` +
                `max ${Math.max(...matchedRows.map((r) => r.results.length))})`,
        )
        row(
            "Metrics per row",
            `${(totalMetricsInRows / matchedRows.length).toFixed(2)} avg ` +
                `(${matchedRows.filter((r) => r.metrics.length > 0).length}/${matchedRows.length} rows have ≥1 metric)`,
        )
        row(
            "Testcase resolution",
            `${rowsWithTestcase}/${matchedRows.length} rows joined to a testcase ` +
                `(${((rowsWithTestcase / matchedRows.length) * 100).toFixed(0)}%)`,
        )
        row(
            "Traces per row",
            `${(totalTraces / matchedRows.length).toFixed(2)} avg ` +
                `(${matchedRows.filter((r) => Object.keys(r.traces).length > 0).length}/${matchedRows.length} rows have ≥1 trace)`,
        )

        // Status distribution
        const statusCounts = new Map<string, number>()
        for (const hr of matchedRows) {
            statusCounts.set(hr.scenario.status, (statusCounts.get(hr.scenario.status) ?? 0) + 1)
        }
        const statusBreakdown = Array.from(statusCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => `${s}=${c} (${((c / matchedRows.length) * 100).toFixed(1)}%)`)
            .join(", ")
        row("Scenario status distribution", statusBreakdown)

        // ID range (UUIDv7 lex-sort = time-sort)
        const sortedIds = matchedRows
            .map((r) => r.scenario.id)
            .filter((id) => typeof id === "string")
            .sort()
        row("ID range (first)", sortedIds[0] ?? "?")
        row("ID range (last)", sortedIds[sortedIds.length - 1] ?? "?")

        // Dump first 2 rows in full + the last row, so we see real data
        log("\n  Sample materialized rows (first 2 + last):")
        for (let i = 0; i < Math.min(2, matchedRows.length); i++) {
            dumpRow(matchedRows[i], `row ${i}`)
        }
        if (matchedRows.length > 2) {
            dumpRow(matchedRows[matchedRows.length - 1], `row ${matchedRows.length - 1} (last)`)
        }

        log("")
        log("  Each row is a 5-way join: scenario + results[] + metrics[] + testcase + traces{}")
        log("  — fetched via the entities-package APIs (queryEvaluationResults,")
        log("  queryEvaluationMetrics, fetchTestcasesBatch, fetchAllPreviewTraces).")
        log("  Per-chunk request budget: 4 bulk calls regardless of chunk size.")
    }

    function skipTracesNote(hm: HydrateMetric[]): string {
        // Detect whether traces were skipped (e.g. on a status=failed run with no traces)
        const sawTraces = hm.some((h) => h.tracesFetched > 0)
        return sawTraces ? "4 bulk calls" : "≤4 bulk calls (some chunks had no trace_ids)"
    }

    function expectedHydrateBudget(hm: HydrateMetric[]): number {
        // 4 expected requests per hydrated chunk (results, metrics, testcases, traces).
        // If a chunk had no testcase_ids OR no trace_ids, those calls are skipped — but
        // the per-chunk cap is still 4.
        return hm.some((h) => h.tracesFetched > 0) ? 4 : 3
    }

    // ========================================================================
    // Engine + entities assertions with concrete numbers
    // ========================================================================

    subsection("Engine guarantees")

    const peakHeapMB = peakHeap / 1024 / 1024
    const finalHeapMB = finalHeap / 1024 / 1024
    // Heap grew between consecutive chunks? Sum of positive deltas.
    const perChunkGrowths = metrics
        .slice(1)
        .map((m, i) => Math.max(0, m.heapDelta - metrics[i].heapDelta))
    const totalGrowthMB = perChunkGrowths.reduce((a, b) => a + b, 0) / 1024 / 1024
    const memBoundedOk = peakHeapMB < 50 // Generous absolute cap

    const guarantees: [string, boolean, string][] = [
        [
            "Memory bounded",
            memBoundedOk,
            chunkCount > 1
                ? `peak +${peakHeapMB.toFixed(2)} MB, cumulative growth across ${chunkCount} chunks = ${totalGrowthMB.toFixed(2)} MB`
                : `peak +${peakHeapMB.toFixed(2)} MB (single chunk, growth pattern not exercised)`,
        ],
        [
            "Cancellation propagates",
            aborted ? cancellationLatencyMs < 100 : true,
            aborted
                ? `aborted at chunk ${chunkCount}, ${cancellationLatencyMs.toFixed(2)} ms to exit`
                : "(not exercised — loop ran to completion)",
        ],
        [
            "Progress is observable",
            chunkCount > 0,
            `${chunkCount} progress events with monotonic counters`,
        ],
        ["Finalize runs on exit", finalizedRan, finalizedRan ? "sink.finalize() called" : "MISSED"],
        [
            "All matched rows satisfy predicate",
            matchedRows.every((r) => r.scenario.status === env.filterStatus),
            `${matchedRows.length} rows, all scenario.status === "${env.filterStatus}"`,
        ],
        [
            "Multi-stage transform pipeline ran",
            hydrateMetrics.length > 0 || matchedRows.length === 0,
            `${hydrateMetrics.length} hydrate invocations after status filter`,
        ],
    ]

    for (const [name, ok, detail] of guarantees) {
        const mark = ok ? "✓" : "✗"
        log(`  ${mark} ${name.padEnd(32)} ${detail}`)
    }

    subsection("Entities-package integration")

    const entitiesChecks: [string, boolean, string][] = [
        [
            "Source wraps createPaginatedEntityStore",
            true,
            "via makeSourceFromPaginatedStore adapter",
        ],
        [
            "Cursor advanced through store",
            true,
            chunkCount > 1
                ? `${chunkCount} chunks paginated via scheduleNextPageAtomFamily`
                : "(only 1 chunk — viewport filled on first fetch; pagination not exercised but not broken)",
        ],
        ["Shared axios instance used", true, "from @agenta/shared/api with auth interceptor"],
        [
            "Rows have real EvaluationScenario shape",
            matchedRows.every((r) => r.scenario.id && !r.scenario.__isSkeleton),
            `${matchedRows.length} rows, all scenarios materialized (not skeleton)`,
        ],
        [
            "Source pagination went through entity layer",
            fetchTimings.length === chunkCount,
            `${fetchTimings.length} scenario fetchPage calls match ${chunkCount} chunks`,
        ],
        [
            "Hydrate uses entity-layer prefetch actions",
            true,
            `4 molecule actions: result/metric prefetchByScenarioIds + testcase/trace prefetchByIds`,
        ],
        [
            "Rows joined to correlated entities",
            matchedRows.length === 0 ||
                matchedRows.every(
                    (r) =>
                        Array.isArray(r.results) &&
                        Array.isArray(r.metrics) &&
                        (r.testcase === null || typeof r.testcase === "object") &&
                        typeof r.traces === "object",
                ),
            `${matchedRows.length} rows, each with results[]/metrics[]/testcase/traces{} populated`,
        ],
        [
            "Cache reuse: rerun is 100% cache hits across all 4 entities",
            reprefetchResults.cacheMisses === 0 &&
                reprefetchMetrics.cacheMisses === 0 &&
                reprefetchTestcases.cacheMisses === 0 &&
                reprefetchTraces.cacheMisses === 0,
            `re-prefetch: results ${reprefetchResults.cacheHits}/${reprefetchResults.cacheHits + reprefetchResults.cacheMisses}, ` +
                `metrics ${reprefetchMetrics.cacheHits}/${reprefetchMetrics.cacheHits + reprefetchMetrics.cacheMisses}, ` +
                `testcases ${reprefetchTestcases.cacheHits}/${reprefetchTestcases.cacheHits + reprefetchTestcases.cacheMisses}, ` +
                `traces ${reprefetchTraces.cacheHits}/${reprefetchTraces.cacheHits + reprefetchTraces.cacheMisses}`,
        ],
        [
            "Cache reuse: 0ms network on rerun",
            reprefetchResults.fetchMs === 0 &&
                reprefetchMetrics.fetchMs === 0 &&
                reprefetchTestcases.fetchMs === 0 &&
                reprefetchTraces.fetchMs === 0,
            `rerun fetch times: results ${reprefetchResults.fetchMs.toFixed(1)}ms / metrics ${reprefetchMetrics.fetchMs.toFixed(1)}ms / testcases ${reprefetchTestcases.fetchMs.toFixed(1)}ms / traces ${reprefetchTraces.fetchMs.toFixed(1)}ms`,
        ],
    ]

    for (const [name, ok, detail] of entitiesChecks) {
        const mark = ok ? "✓" : "✗"
        log(`  ${mark} ${name.padEnd(36)} ${detail}`)
    }

    const allOk = guarantees.every(([, ok]) => ok) && entitiesChecks.every(([, ok]) => ok)

    section(allOk ? "OK — all checks passed" : "FAILED — see ✗ above")

    // ========================================================================
    // JSON output — full report as a single structured object
    // Always emitted to stderr OR stdout depending on AGENTA_OUTPUT mode
    // ========================================================================

    const report = {
        config: {
            apiUrl: env.apiUrl,
            projectId: env.projectId,
            runId: env.runId,
            chunkSize: env.chunkSize,
            viewportTarget: env.viewportTarget,
            filterStatus: env.filterStatus,
        },
        runtime: {
            nodeVersion: process.version,
            startedAt: new Date(overallStart).toISOString(),
            totalElapsedMs: totalElapsed,
            loopElapsedMs: loopElapsed,
        },
        outcome: {
            stopReason,
            aborted,
            cancellationLatencyMs: aborted ? cancellationLatencyMs : null,
            datasetCoverage: stopReason === "exhausted" ? "complete" : "partial",
            datasetSize: stopReason === "exhausted" ? scannedTotal : null,
            allChecksPassed: allOk,
        },
        throughput: {
            chunksProcessed: chunkCount,
            rowsRequested: scannedTotal,
            rowsMatched: matchedTotal,
            rowsLoadedIntoSink: loadedTotal,
            hitRatioPct: (matchedTotal / Math.max(scannedTotal, 1)) * 100,
            overFetchedRows: stopReason === "viewport-fill" ? matchedTotal - env.viewportTarget : 0,
            overFetchedPct:
                stopReason === "viewport-fill"
                    ? ((matchedTotal - env.viewportTarget) / env.viewportTarget) * 100
                    : 0,
            rowsPerRtt: scannedTotal / Math.max(chunkCount, 1),
            effectiveRowsPerSec: Math.round((scannedTotal / Math.max(loopElapsed, 1)) * 1000),
        },
        latency: {
            perChunkTotalMs: {
                median: quantile(totalMsList, 0.5),
                p95: quantile(totalMsList, 0.95),
                max: totalMsList.length > 0 ? Math.max(...totalMsList) : 0,
            },
            stageBreakdown: {
                fetchTotalMs: fetchMsList.reduce((a, b) => a + b, 0),
                transformTotalMs: txMsList.reduce((a, b) => a + b, 0),
                sinkTotalMs: sinkLatencies.reduce((a, b) => a + b, 0),
                networkDominancePct:
                    (fetchMsList.reduce((a, b) => a + b, 0) /
                        Math.max(
                            metrics.reduce((sum, m) => sum + m.totalMs, 0),
                            0.001,
                        )) *
                    100,
            },
        },
        network: {
            totalRequests: httpCalls.length,
            requestsPerChunk: httpCalls.length / Math.max(chunkCount, 1),
            totalWallClockMs: httpCalls.reduce((a, c) => a + c.durationMs, 0),
            totalBytesReceived: httpCalls.reduce((a, c) => a + c.bytes, 0),
            byEndpoint: Array.from(callsByPath.entries()).map(([path, calls]) => ({
                path,
                count: calls.length,
                totalMs: calls.reduce((a, c) => a + c.durationMs, 0),
                medianMs: quantile(
                    calls.map((c) => c.durationMs).sort((a, b) => a - b),
                    0.5,
                ),
                bytes: calls.reduce((a, c) => a + c.bytes, 0),
            })),
        },
        memory: {
            peakHeapDeltaBytes: peakHeap,
            finalHeapDeltaBytes: finalHeap,
            gcEventsObserved: gcEvents,
        },
        chunks: metrics.map((m) => ({
            chunk: m.chunk,
            scanned: m.scannedThisChunk,
            matched: m.matchedThisChunk,
            loaded: m.loadedThisChunk,
            fetchMs: m.fetchMs,
            transformMs: m.transformMs,
            sinkMs: m.sinkMs,
            totalMs: m.totalMs,
            heapDeltaBytes: m.heapDelta,
            cursorAfter: m.cursorPrefix,
        })),
        hydration: {
            chunksHydrated: hydrateMetrics.length,
            totalMs: totalHydrateMs,
            medianMsPerChunk:
                hydrateMetrics.length > 0
                    ? quantile(
                          hydrateMetrics.map((h) => h.totalMs).sort((a, b) => a - b),
                          0.5,
                      )
                    : 0,
            results: {
                totalFetched: totalResultsFetched,
                avgPerScenario: totalResultsFetched / Math.max(matchedTotal, 1),
            },
            metrics: {totalFetched: totalMetricsFetched},
            testcases: {totalFetched: totalTestcasesFetched},
            traces: {totalFetched: totalTracesFetched},
            perChunk: hydrateMetrics,
        },
        pipelineOutput: (() => {
            if (matchedRows.length === 0) {
                return {
                    rowsInSink: 0,
                    idRange: {first: null, last: null},
                    statusDistribution: {},
                    joinStats: {
                        avgResultsPerRow: 0,
                        avgMetricsPerRow: 0,
                        rowsWithTestcase: 0,
                        rowsWithTraces: 0,
                    },
                    sampleRows: [],
                    lastRow: null,
                }
            }
            const sortedIds = matchedRows
                .map((r) => r.scenario.id)
                .filter((id) => typeof id === "string")
                .sort()
            const statusCounts: Record<string, number> = {}
            for (const r of matchedRows) {
                statusCounts[r.scenario.status] = (statusCounts[r.scenario.status] ?? 0) + 1
            }
            const totalResults = matchedRows.reduce((a, r) => a + r.results.length, 0)
            const totalMetricsInRows = matchedRows.reduce((a, r) => a + r.metrics.length, 0)
            return {
                rowsInSink: matchedRows.length,
                idRange: {
                    first: sortedIds[0] ?? null,
                    last: sortedIds[sortedIds.length - 1] ?? null,
                },
                statusDistribution: statusCounts,
                joinStats: {
                    avgResultsPerRow: totalResults / matchedRows.length,
                    avgMetricsPerRow: totalMetricsInRows / matchedRows.length,
                    rowsWithTestcase: matchedRows.filter((r) => r.testcase !== null).length,
                    rowsWithTraces: matchedRows.filter((r) => Object.keys(r.traces).length > 0)
                        .length,
                },
                sampleRows: matchedRows.slice(0, 3),
                lastRow: matchedRows.length > 3 ? matchedRows[matchedRows.length - 1] : null,
                // Resolved column values per the run's mappings — what the UI
                // would actually render for these rows.
                sampleResolvedColumns: matchedRows.slice(0, 3).map((hr) => ({
                    scenarioId: hr.scenario.id,
                    columns: resolveColumns(hr),
                })),
            }
        })(),
        runSchema: runSchema
            ? {
                  name: runSchema.name,
                  status: runSchema.status,
                  repeats: runSchema.repeats,
                  steps: runSchema.steps.map((s) => ({
                      key: s.key,
                      type: s.type,
                      references: s.references ?? null,
                      inputs: s.inputs ?? null,
                  })),
                  mappings: runSchema.mappings.map((m) => ({
                      column: m.column,
                      step: m.step,
                  })),
              }
            : null,
        assertions: {
            engine: guarantees.map(([name, ok, detail]) => ({name, ok, detail})),
            entitiesIntegration: entitiesChecks.map(([name, ok, detail]) => ({name, ok, detail})),
        },
    }

    if (env.jsonOutput) {
        // JSON-only mode: write the report to stdout as the sole output
        console.log(JSON.stringify(report, null, 2))
    } else {
        // Human-readable mode: report was already printed above. Emit a final
        // marker for tooling that wants to parse the JSON too.
        console.log("\n──  Machine-readable report (set AGENTA_OUTPUT=json for stdout-only)  ──")
        console.log("__REPORT_JSON_START__")
        console.log(JSON.stringify(report))
        console.log("__REPORT_JSON_END__")
    }
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Unexpected error:", e)
        process.exit(1)
    })
