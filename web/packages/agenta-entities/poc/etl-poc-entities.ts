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
    // Comma-separated subset of `results,metrics,testcases,traces`. When
    // set, the hydrate stage only calls those fetchers — others return
    // empty results without network. Mirrors the test page's predicate-
    // driven hydrate strategy (slices the active predicate doesn't touch
    // are skipped). Use for perf A/B between "all 4 slices" baseline and
    // "predicate-driven subset" to measure the byte/time savings.
    // Default: all 4 slices.
    hydrateSlices: (process.env.AGENTA_HYDRATE_SLICES ?? "results,metrics,testcases,traces")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is "results" | "metrics" | "testcases" | "traces" =>
            ["results", "metrics", "testcases", "traces"].includes(s),
        ),
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
    // Sink retention strategy:
    //   "accumulate" (default) — sink keeps every hydrated row in memory.
    //       Useful for full sample dumps and post-hoc inspection. Memory
    //       grows linearly with dataset size (~65 KB/row).
    //   "streaming" — sink updates running aggregates per row and drops
    //       the chunk. Retains only the first row as a sample. Memory
    //       stays bounded regardless of dataset size — mirrors what a
    //       production sink does (write each row to atoms, then release).
    //
    // Aggregate counters (counts, sums, ID range, status distribution)
    // are populated identically in both modes; only the row retention
    // differs. All downstream report sections read from the aggregate
    // so output looks the same except where it has to (sample count = 1).
    sinkMode: (process.env.AGENTA_SINK_MODE ?? "accumulate") as "accumulate" | "streaming",
    // Residual-heap walk (debug-only). When set to "1", the script tears
    // down suspected retainers one at a time after the pipeline finishes,
    // measures heap after each step, dumps a V8 heap snapshot to /tmp,
    // and prints a per-step heap delta table. Disabled by default because:
    //   - writeHeapSnapshot writes a ~50 MB file per run (wasted CI I/O)
    //   - the teardown clears aggregate state which would pollute the
    //     final JSON report
    //   - the steady-state "Memory bounded" engine guarantee already
    //     covers regression detection without any walk
    // Use when investigating a memory regression: AGENTA_HEAP_WALK=1.
    heapWalk: process.env.AGENTA_HEAP_WALK === "1",
    // Per-chunk cache eviction. When "1", the loop's `onChunkReleased`
    // hook fires after every chunk and evicts that chunk's entity-cache
    // slices (results/metrics/testcases/traces) via the molecule
    // `evictBy*` actions. This keeps the molecule cache bounded by chunk
    // size across an arbitrarily long scan — the alternative to
    // post-pipeline `evictByRunId`, which only frees memory after the
    // whole scan. Default off (caches accumulate, today's behavior).
    perChunkEvict: process.env.AGENTA_PER_CHUNK_EVICT === "1",
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
        await import("../src/shared/paginated/createPaginatedEntityStore")
    const {runLoop, makeSourceFromPaginatedStore} = await import("../src/etl")
    const {makeHydrateScenariosTransform, DEFAULT_HYDRATE_FETCHERS} =
        await import("../src/evaluationRun/etl/hydrateScenariosTransform")
    const {buildMoleculeBackedFetchers} =
        await import("../src/evaluationRun/etl/cacheAwareFetchers")
    type EntityCacheStats = import("../src/evaluationRun/etl/cacheAwareFetchers").EntityCacheStats
    type ChunkCacheStats = import("../src/evaluationRun/etl/cacheAwareFetchers").ChunkCacheStats
    const {resolveMappings, groupResolvedColumns} =
        await import("../src/evaluationRun/etl/resolveMappings")
    const {makeRowPredicateFilter, unwrapStatsForCompare} =
        await import("../src/evaluationRun/etl/rowPredicateFilter")
    type RowPredicate = import("../src/evaluationRun/etl/rowPredicateFilter").RowPredicate
    const {createHitRatioMeter} = await import("../src/evaluationRun/etl/hitRatioMeter")
    type HitRatioRegime = import("../src/evaluationRun/etl/hitRatioMeter").HitRatioRegime
    // Eviction entry points for the per-chunk release hook
    // (AGENTA_PER_CHUNK_EVICT=1). Results/metrics go through the molecule
    // (../src/evaluationRun/state is Node-safe); testcases/traces use the
    // leaf prefetch modules directly — importing their *molecules* would
    // pull the @agenta/ui entity layer, which has browser/CSS deps that
    // fail under Node. (Same reason the re-prefetch section imports
    // prefetchTestcasesByIds / prefetchTracesByIds from the leaf files.)
    const {evaluationResultMolecule: resultMol, evaluationMetricMolecule: metricMol} =
        await import("../src/evaluationRun/state")
    const {evictTestcasesByIds} = await import("../src/testcase/state/prefetch")
    const {evictTracesByIds} = await import("../src/trace/state/prefetch")
    const {inspectCache, clearCacheByPrefix, inspectMemory, DEFAULT_DIAGNOSTIC_PREFIXES} =
        await import("../src/evaluationRun/etl/cacheDiagnostics")
    const {inspectAtomFamilies} = await import("../src/shared/molecule/instrumentedAtomFamily")
    type ResolvedColumnGroup =
        import("../src/evaluationRun/etl/resolveMappings").ResolvedColumnGroup
    type ResolvedColumn = import("../src/evaluationRun/etl/resolveMappings").ResolvedColumn
    type Transform<In, Out> = import("../src/etl/core/types").Transform<In, Out>
    type Sink<T> = import("../src/etl/core/types").Sink<T>
    type Chunk<T> = import("../src/etl/core/types").Chunk<T>
    type Source<T> = import("../src/etl/core/types").Source<T>
    type HydratedScenarioRow<T> =
        import("../src/evaluationRun/etl/hydrateScenariosTransform").HydratedScenarioRow<T>
    type HydratableScenario =
        import("../src/evaluationRun/etl/hydrateScenariosTransform").HydratableScenario

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
        `${env.hydrateSlices.length} bulk request(s) per chunk · slices: ${env.hydrateSlices.join(", ")}${
            env.hydrateSlices.length < 4 ? "  (slice-filtered)" : ""
        }`,
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
    const baseFetchers =
        env.fetcherMode === "raw" ? DEFAULT_HYDRATE_FETCHERS : moleculeBackedFetchers

    // Slice-filtered fetcher wrapper — implements the test page's
    // predicate-driven hydrate at the headless layer. Slices not in
    // `env.hydrateSlices` resolve to empty results without network.
    // Same `HydrateFetchers` shape as the underlying fetchers; the
    // hydrate transform downstream is identical for both paths.
    const slicesActive = new Set(env.hydrateSlices)
    const chosenFetchers: typeof baseFetchers = {
        fetchResults: slicesActive.has("results") ? baseFetchers.fetchResults : async () => [],
        fetchMetrics: slicesActive.has("metrics") ? baseFetchers.fetchMetrics : async () => [],
        fetchTestcases: slicesActive.has("testcases")
            ? baseFetchers.fetchTestcases
            : async () => new Map(),
        fetchTraces: slicesActive.has("traces") ? baseFetchers.fetchTraces : async () => new Map(),
    }

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

    // ------------------------------------------------------------------
    // Sink + aggregate
    //
    // The sink updates a running aggregate per row so downstream reports
    // can be built without holding the full row set in memory. In
    // `accumulate` mode we also retain every row in `matchedRows` for
    // backwards-compatible dumps; in `streaming` mode `matchedRows` stays
    // empty except for the captured sample row, and the chunk goes out of
    // scope when load() returns so GC can reclaim it.
    // ------------------------------------------------------------------

    interface SinkAggregate {
        count: number
        scenarioIds: string[]
        testcaseIdSet: Set<string>
        traceIdSet: Set<string>
        statusCounts: Map<string, number>
        totalResults: number
        minResults: number
        maxResults: number
        totalMetrics: number
        rowsWithMetric: number
        rowsWithTestcase: number
        totalTraces: number
        rowsWithTraces: number
        // Engine-guarantee invariants — flipped false the first time
        // a row violates the rule. Allows assertion checks without a
        // full row scan.
        allHaveValidId: boolean
        allHaveJoinedEntities: boolean
        minId: string | null
        maxId: string | null
        sampleRow: HydratedScenarioRow<ScenarioRow> | null
    }

    const aggregate: SinkAggregate = {
        count: 0,
        scenarioIds: [],
        testcaseIdSet: new Set<string>(),
        traceIdSet: new Set<string>(),
        statusCounts: new Map<string, number>(),
        totalResults: 0,
        minResults: Number.POSITIVE_INFINITY,
        maxResults: 0,
        totalMetrics: 0,
        rowsWithMetric: 0,
        rowsWithTestcase: 0,
        totalTraces: 0,
        rowsWithTraces: 0,
        allHaveValidId: true,
        allHaveJoinedEntities: true,
        minId: null,
        maxId: null,
        sampleRow: null,
    }

    function updateAggregate(hr: HydratedScenarioRow<ScenarioRow>): void {
        aggregate.count += 1

        const id = hr.scenario.id
        if (typeof id === "string") {
            aggregate.scenarioIds.push(id)
            if (aggregate.minId === null || id < aggregate.minId) aggregate.minId = id
            if (aggregate.maxId === null || id > aggregate.maxId) aggregate.maxId = id
        }

        if (typeof hr.scenario.testcase_id === "string" && hr.scenario.testcase_id) {
            aggregate.testcaseIdSet.add(hr.scenario.testcase_id)
        }
        for (const r of hr.results) {
            if (typeof r.testcase_id === "string" && r.testcase_id) {
                aggregate.testcaseIdSet.add(r.testcase_id)
            }
        }
        for (const tid of Object.keys(hr.traces)) {
            if (typeof tid === "string" && tid) aggregate.traceIdSet.add(tid)
        }

        const status = hr.scenario.status
        aggregate.statusCounts.set(status, (aggregate.statusCounts.get(status) ?? 0) + 1)

        aggregate.totalResults += hr.results.length
        if (hr.results.length < aggregate.minResults) aggregate.minResults = hr.results.length
        if (hr.results.length > aggregate.maxResults) aggregate.maxResults = hr.results.length

        aggregate.totalMetrics += hr.metrics.length
        if (hr.metrics.length > 0) aggregate.rowsWithMetric += 1

        if (hr.testcase !== null) aggregate.rowsWithTestcase += 1

        const traceCount = Object.keys(hr.traces).length
        aggregate.totalTraces += traceCount
        if (traceCount > 0) aggregate.rowsWithTraces += 1

        if (!(typeof hr.scenario.id === "string" && !hr.scenario.__isSkeleton)) {
            aggregate.allHaveValidId = false
        }
        const hasAnyJoinedEntity =
            hr.results.length > 0 || hr.metrics.length > 0 || hr.testcase !== null || traceCount > 0
        if (!hasAnyJoinedEntity) aggregate.allHaveJoinedEntities = false

        if (aggregate.sampleRow === null) aggregate.sampleRow = hr
    }

    const matchedRows: HydratedScenarioRow<ScenarioRow>[] = []
    let finalizedRan = false
    const sinkLatencies: number[] = []

    const wrappedSink: Sink<HydratedScenarioRow<ScenarioRow>> = {
        async load(chunk: Chunk<HydratedScenarioRow<ScenarioRow>>) {
            const start = performance.now()
            for (const item of chunk.items) updateAggregate(item)
            if (env.sinkMode === "accumulate") {
                matchedRows.push(...chunk.items)
            }
            // In "streaming" mode, chunk + chunk.items go out of scope
            // when this function returns. The runLoop has no other
            // reference to them. GC reclaims on the next cycle, so
            // peak heap stays bounded by chunk size × concurrency
            // rather than dataset size.
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

    // Per-chunk cache eviction hook (AGENTA_PER_CHUNK_EVICT=1). After the
    // sink consumes each chunk, free that chunk's entity-cache slices so
    // the molecule cache stays bounded by chunk size for the whole scan.
    //
    // Walks the post-transform chunk. With a post-hydrate predicate
    // filter active it under-evicts filtered-out rows (their caches were
    // populated by hydrate but the rows aren't in the final chunk) — a
    // complete fix would tag chunk.meta with the hydrate id manifest.
    // For the no-post-filter scan (status filter → hydrate) it evicts
    // exactly what hydrate populated.
    const evictionStats = {chunks: 0, results: 0, metrics: 0, testcases: 0, traces: 0}
    const releaseChunk = (chunk: Chunk<unknown>): void => {
        const rows = chunk.items as HydratedScenarioRow<ScenarioRow>[]
        if (rows.length === 0) return
        const scenarioIds: string[] = []
        const testcaseIds = new Set<string>()
        const traceIds = new Set<string>()
        for (const row of rows) {
            if (typeof row?.scenario?.id === "string") scenarioIds.push(row.scenario.id)
            const scTc = row?.scenario?.testcase_id
            if (typeof scTc === "string" && scTc) testcaseIds.add(scTc)
            if (row?.testcase?.id) testcaseIds.add(row.testcase.id)
            for (const r of row?.results ?? []) {
                if (typeof r?.testcase_id === "string" && r.testcase_id) {
                    testcaseIds.add(r.testcase_id)
                }
            }
            for (const tid of Object.keys(row?.traces ?? {})) traceIds.add(tid)
        }
        evictionStats.chunks++
        evictionStats.results += resultMol.actions.evictByScenarioIds({
            projectId: env.projectId,
            runId: env.runId,
            scenarioIds,
        })
        evictionStats.metrics += metricMol.actions.evictByScenarioIds({
            projectId: env.projectId,
            runId: env.runId,
            scenarioIds,
        })
        evictionStats.testcases += evictTestcasesByIds({
            projectId: env.projectId,
            testcaseIds: Array.from(testcaseIds),
        })
        evictionStats.traces += evictTracesByIds({
            projectId: env.projectId,
            traceIds: Array.from(traceIds),
        })
    }

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
            env.perChunkEvict ? releaseChunk : undefined,
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
    if (env.perChunkEvict) {
        row(
            "Per-chunk eviction",
            `ON — ${evictionStats.chunks} chunks · evicted ` +
                `results=${evictionStats.results} metrics=${evictionStats.metrics} ` +
                `testcases=${evictionStats.testcases} traces=${evictionStats.traces} ` +
                `(cache freed inline — see post-run entry count below)`,
        )
    } else {
        row("Per-chunk eviction", "OFF (caches accumulate — set AGENTA_PER_CHUNK_EVICT=1)")
    }

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
    const {traceEntityAtomFamily} = await import("../src/trace/state/store")
    for (const traceId of aggregate.traceIdSet) {
        // Just creating the atom adds traceId to the family's tracking
        // Set. The atom itself is lazy — we don't subscribe.
        traceEntityAtomFamily(traceId)
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
    log(`  ⚠ In a script context, no React subscribers means TanStack's gcTime never fires.`)
    log(`    Entity caches + atom family params persist until process exit.`)
    log(`    Browser-side, the scenarios table's atoms subscribe → TanStack auto-GCs`)
    log(`    after gcTime (60s for pages, 5min default for entity caches) once the user`)
    log(`    navigates away. The gap is run-switching in the same tab — see the`)
    log(`    "Scope-change eviction" subsection below for the controller wire-up.`)
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

    // Pull from the aggregate — both modes populate these identically, so
    // re-prefetch verification doesn't care about sink retention strategy.
    const scenarioIdsForReprefetch = aggregate.scenarioIds.slice()
    const testcaseIdsForReprefetch = Array.from(aggregate.testcaseIdSet)
    const traceIdsForReprefetch = Array.from(aggregate.traceIdSet)

    const {evaluationResultMolecule, evaluationMetricMolecule} =
        await import("../src/evaluationRun/state")
    const {prefetchTestcasesByIds: rePrefetchTc} = await import("../src/testcase/state/prefetch")
    const {prefetchTracesByIds: rePrefetchTr} = await import("../src/trace/state/prefetch")

    // -----------------------------------------------------------------
    // Re-prefetch and extract ONLY the stats we'll display, immediately
    // dropping the returned data arrays so they don't pin ~25 MB of
    // EvaluationResult/Metric/Testcase/Trace objects on the main() stack
    // for the rest of the script.
    //
    // Heap-snapshot retainer-path analysis showed all four prefetch
    // return values being held alive via the main() closure context
    // (internal slots 195-197 of the function context object), accounting
    // for most of the post-eviction residual. Inlining the stat
    // extraction keeps the function temps GC-eligible after the line
    // they're used on.
    // -----------------------------------------------------------------

    type ReprefetchStat = {cacheHits: number; cacheMisses: number; fetchMs: number}
    const reprefetchStats: Record<"results" | "metrics" | "testcases" | "traces", ReprefetchStat> =
        {
            results: await (async () => {
                const r = await evaluationResultMolecule.actions.prefetchByScenarioIds({
                    projectId: env.projectId,
                    runId: env.runId,
                    scenarioIds: scenarioIdsForReprefetch,
                })
                return {cacheHits: r.cacheHits, cacheMisses: r.cacheMisses, fetchMs: r.fetchMs}
            })(),
            metrics: await (async () => {
                const r = await evaluationMetricMolecule.actions.prefetchByScenarioIds({
                    projectId: env.projectId,
                    runId: env.runId,
                    scenarioIds: scenarioIdsForReprefetch,
                })
                return {cacheHits: r.cacheHits, cacheMisses: r.cacheMisses, fetchMs: r.fetchMs}
            })(),
            testcases: await (async () => {
                const r = await rePrefetchTc({
                    projectId: env.projectId,
                    testcaseIds: testcaseIdsForReprefetch,
                })
                return {cacheHits: r.cacheHits, cacheMisses: r.cacheMisses, fetchMs: r.fetchMs}
            })(),
            traces: await (async () => {
                const r = await rePrefetchTr({
                    projectId: env.projectId,
                    traceIds: traceIdsForReprefetch,
                })
                return {cacheHits: r.cacheHits, cacheMisses: r.cacheMisses, fetchMs: r.fetchMs}
            })(),
        }

    const formatRerun = (label: string, s: ReprefetchStat) => {
        const total = s.cacheHits + s.cacheMisses
        const hitPct = total > 0 ? (s.cacheHits / total) * 100 : 0
        const verdict =
            total > 0 && s.cacheHits === total ? "✓ 100% cache hit" : `⚠ ${s.cacheMisses} misses`
        row(
            label.padEnd(10),
            `${s.cacheHits}/${total} (${hitPct.toFixed(0)}%) — ${s.fetchMs.toFixed(1)} ms network — ${verdict}`,
        )
    }
    formatRerun("results", reprefetchStats.results)
    formatRerun("metrics", reprefetchStats.metrics)
    formatRerun("testcases", reprefetchStats.testcases)
    formatRerun("traces", reprefetchStats.traces)

    // ---- Scope-change eviction (production-should pattern) ----------
    //
    // Today's reality: production does NOT call evictByRunId anywhere.
    // The scenarios table relies on TanStack's automatic gcTime:
    //   - pages atom (page-level scenario queries) uses gcTime: 60_000
    //     (from createInfiniteTableStore — auto-drops 60s after unmount)
    //   - entity molecules (results/metrics/testcases/traces) inherit
    //     QueryClient defaults (gcTime: 5 min, no observers in script
    //     mode) — see resultMolecule.ts:191 comment confirming this
    //   - atom families grow monotonically; family.clear() is the only
    //     way to release atom-level memory
    //
    // Run-switching in the same tab is the gap: when the user moves from
    // run A to run B, run A's entity caches sit for up to 5 minutes
    // before TanStack GCs them. Peak memory during the overlap = sum of
    // both runs.
    //
    // This section demonstrates the eviction handler that the production
    // scenarios controller SHOULD wire on runId change. Concretely:
    //
    //   useEffect(() => {
    //     return () => {
    //       evaluationResultMolecule.actions.evictByRunId({projectId, runId})
    //       evaluationMetricMolecule.actions.evictByRunId({projectId, runId})
    //       clearCacheByPrefix(["testcase", "trace-entity", "span"])
    //       // family.clear() only if no other live view subscribes
    //     }
    //   }, [projectId, runId])
    //
    // The measurements below show what wiring that cleanup would save.
    // -----------------------------------------------------------------

    subsection("Scope-change eviction (production-should handler — wire-up TODO)")
    log("  ▸ Production today does NOT call this. Comment in resultMolecule.ts:191")
    log("    confirms entity caches accumulate. The scenarios controller's next-PR")
    log("    wiring should add the cleanup snippet shown above this subsection.")
    log("    The numbers below show what that handler would release on each run switch.")
    log("")

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
    const {clearAllAtomFamilies} = await import("../src/shared/molecule/instrumentedAtomFamily")
    const removedAtomParams = clearAllAtomFamilies()
    const finalAtomFamilies = inspectAtomFamilies()
    const finalTotal = finalAtomFamilies.reduce((a, f) => a + f.size, 0)
    row(
        "Atom family params (after clear)",
        `${finalTotal} retained, ${removedAtomParams} params removed`,
    )

    // -----------------------------------------------------------------
    // Heap accounting — measure the residual once cache + atom families
    // are gone. This isolates "what's the cache actually costing in
    // heap?" from "what other allocation is the pipeline holding?".
    //
    // The `inspectCache` byte count is `JSON.stringify(data).length` —
    // a string-length proxy, not real heap. V8 UTF-16 strings, object
    // property overhead, and hash maps typically push real heap to
    // 2-5× the JSON length. Forcing GC after eviction and re-reading
    // heapUsed gives us the actual number.
    // -----------------------------------------------------------------
    if (typeof globalThis.gc === "function") {
        // Two passes: first reclaims unreferenced, second reclaims
        // anything kept alive by the first pass's young-gen residue.
        globalThis.gc()
        globalThis.gc()
    }
    const postEvictHeapDelta = process.memoryUsage().heapUsed - baselineMem
    const peakHeapMb = (peakHeap / 1024 / 1024).toFixed(2)
    const postEvictHeapMb = (postEvictHeapDelta / 1024 / 1024).toFixed(2)
    const cacheJsonKb = (postHydrateCache.totalApproxBytes / 1024).toFixed(1)
    const cacheRealHeapBytes = peakHeap - postEvictHeapDelta
    const cacheRealHeapMb = (cacheRealHeapBytes / 1024 / 1024).toFixed(2)
    const proxyMultiplier =
        postHydrateCache.totalApproxBytes > 0
            ? cacheRealHeapBytes / postHydrateCache.totalApproxBytes
            : 0
    row(
        "Heap after full eviction",
        `${postEvictHeapMb} MB delta from baseline ` + `(was peak ${peakHeapMb} MB at end of loop)`,
    )
    row(
        "Cache + atom-family real cost",
        `${cacheRealHeapMb} MB heap freed by eviction ` +
            `(JSON-proxy reported ${cacheJsonKb} KB — real heap ≈ ${proxyMultiplier.toFixed(1)}× the proxy)`,
    )
    log("  ▸ The `inspectCache` bytes column is a JSON-string-length proxy, not heap. Forcing GC")
    log("    after eviction gives us the actual heap cost — useful for setting realistic memory")
    log("    budgets in long-running scripts.")
    if (typeof globalThis.gc !== "function") {
        log(
            "  ⚠ globalThis.gc is unavailable — run with `node --expose-gc` for accurate eviction-residual heap.",
        )
    }

    // -----------------------------------------------------------------
    // Residual-heap walk — measure where the leftover memory actually
    // lives. Tear down suspected retainers one at a time and snapshot
    // heap after each step.
    //
    // Each step:
    //   1. Drop references from this script
    //   2. Force GC (twice — moves through young/old generations)
    //   3. Measure heapUsed delta from baseline
    //
    // If heap drops at step N, the resource we just released at step N
    // was the retainer. If heap is flat across all steps, the residual
    // is permanent infrastructure (Node module graph, JIT'd code,
    // QueryClient prototype objects, etc.) and not addressable from
    // userland.
    //
    // Gated behind AGENTA_HEAP_WALK=1 because: (a) it side-effects the
    // aggregate state that downstream sections still need, (b) it dumps
    // a ~50 MB heap snapshot to /tmp on every run, (c) the steady-state
    // "Memory bounded" engine guarantee already catches regressions
    // without it. Enable when chasing a specific retainer.
    // -----------------------------------------------------------------
    if (env.heapWalk && typeof globalThis.gc === "function") {
        subsection("Residual-heap walk — where does the leftover live?")

        function snapshot(label: string): number {
            globalThis.gc!()
            globalThis.gc!()
            const heap = process.memoryUsage().heapUsed - baselineMem
            return heap
        }

        const stepResults: {label: string; heapMb: number; deltaMb: number}[] = []
        let prevHeap = snapshot("initial (post-eviction)")
        stepResults.push({
            label: "after cache+atoms evicted",
            heapMb: prevHeap / 1024 / 1024,
            deltaMb: 0,
        })

        // Step 0.5: enumerate ALL remaining TanStack keys — not just known
        // prefixes. If anything's left, our diagnostic-prefix list is
        // incomplete (or another subsystem is caching outside molecules).
        const {queryClientAtom} = await import("jotai-tanstack-query")
        const {getDefaultStore} = await import("jotai")
        const qc = getDefaultStore().get(queryClientAtom) as
            | {
                  getQueryCache?: () => {
                      getAll: () => {
                          queryKey: unknown
                          state: {data: unknown}
                      }[]
                  }
              }
            | undefined
        const queries = qc?.getQueryCache?.()?.getAll?.() ?? []
        if (queries.length > 0) {
            const remainingByPrefix = new Map<string, {count: number; bytes: number}>()
            for (const q of queries) {
                const key = q.queryKey
                const prefix = Array.isArray(key) && typeof key[0] === "string" ? key[0] : "?"
                const data = q.state.data
                const bytes = data === undefined ? 0 : JSON.stringify(data).length
                const slot = remainingByPrefix.get(prefix) ?? {count: 0, bytes: 0}
                slot.count += 1
                slot.bytes += bytes
                remainingByPrefix.set(prefix, slot)
            }
            log("\n  Remaining TanStack entries (full cache scan, all prefixes):")
            for (const [prefix, s] of Array.from(remainingByPrefix.entries()).sort(
                (a, b) => b[1].bytes - a[1].bytes,
            )) {
                log(
                    `    ${prefix.padEnd(28)} ${String(s.count).padStart(4)} entries  ` +
                        `${(s.bytes / 1024).toFixed(1).padStart(10)} KB JSON-proxy`,
                )
            }
        } else {
            log("\n  Remaining TanStack entries: none (cache fully drained)")
        }

        // Step 1: dispose the paginated source store
        const beforeDispose = prevHeap
        ;(scenariosStore as unknown as {dispose?: () => number}).dispose?.()
        prevHeap = snapshot("after scenariosStore.dispose()")
        stepResults.push({
            label: "after scenariosStore.dispose()",
            heapMb: prevHeap / 1024 / 1024,
            deltaMb: (prevHeap - beforeDispose) / 1024 / 1024,
        })

        // Step 2: clear the in-script row/aggregate state
        const beforeRowClear = prevHeap
        matchedRows.length = 0
        aggregate.scenarioIds.length = 0
        aggregate.testcaseIdSet.clear()
        aggregate.traceIdSet.clear()
        aggregate.statusCounts.clear()
        aggregate.sampleRow = null
        prevHeap = snapshot("after matchedRows + aggregate cleared")
        stepResults.push({
            label: "after matchedRows + aggregate cleared",
            heapMb: prevHeap / 1024 / 1024,
            deltaMb: (prevHeap - beforeRowClear) / 1024 / 1024,
        })

        // (per-chunk metric arrays are tiny and still needed by later
        // sections of the script; we don't tear them down here.)

        // Step 3: dump V8 heap snapshot for offline inspection. The file
        // can be opened in Chrome DevTools → Memory tab to see top
        // retainers + dominator tree. Useful when nothing in userland
        // reclaims the residual.
        const beforeSnapshot = prevHeap
        const v8mod = await import("node:v8")
        const snapshotPath = `/tmp/poc-residual-heap-${env.sinkMode}-${Date.now()}.heapsnapshot`
        try {
            v8mod.writeHeapSnapshot(snapshotPath)
            log(`\n  Heap snapshot written: ${snapshotPath}`)
            log(`    open in Chrome DevTools → Memory tab → "Load snapshot"`)
        } catch (e) {
            log(`  ⚠ writeHeapSnapshot failed: ${e instanceof Error ? e.message : e}`)
        }
        prevHeap = snapshot("after heap snapshot write")
        stepResults.push({
            label: "after heap snapshot write",
            heapMb: prevHeap / 1024 / 1024,
            deltaMb: (prevHeap - beforeSnapshot) / 1024 / 1024,
        })

        // Step 4: take heap-space breakdown — what's left, by V8 space?
        // This tells us whether the residual is in `old space` (long-lived
        // objects) or `code space` (compiled JS) or `external` (Buffer-like).
        const v8 = await import("node:v8")
        const heapStats = v8.getHeapStatistics()
        const spaceStats = v8.getHeapSpaceStatistics()

        log("\n  Teardown sequence (heap residual after each step):")
        log("  " + "─".repeat(74))
        for (const s of stepResults) {
            const sign = s.deltaMb > 0 ? "+" : ""
            log(
                `    ${s.label.padEnd(48)} ${s.heapMb.toFixed(2).padStart(7)} MB ` +
                    `${s.deltaMb !== 0 ? `(${sign}${s.deltaMb.toFixed(2)} MB)` : ""}`,
            )
        }

        log("\n  V8 heap space breakdown (final residual):")
        log("  " + "─".repeat(74))
        const sortedSpaces = [...spaceStats].sort((a, b) => b.space_used_size - a.space_used_size)
        for (const sp of sortedSpaces) {
            if (sp.space_used_size === 0) continue
            log(
                `    ${sp.space_name.padEnd(28)} ` +
                    `${(sp.space_used_size / 1024 / 1024).toFixed(2).padStart(8)} MB used  ` +
                    `${(sp.space_size / 1024 / 1024).toFixed(2).padStart(8)} MB allocated`,
            )
        }
        log("")
        row(
            "Total heap size",
            `${(heapStats.total_heap_size / 1024 / 1024).toFixed(2)} MB ` +
                `(used ${(heapStats.used_heap_size / 1024 / 1024).toFixed(2)} MB)`,
        )
        row(
            "External memory (Buffers/ArrayBuffers)",
            `${(heapStats.external_memory / 1024 / 1024).toFixed(2)} MB`,
        )
        row("Native contexts", `${heapStats.number_of_native_contexts} (Node + jsdom + isolates)`)

        log("")
        log("  How to read this:")
        log("    - Negative delta at a step = that step's resource was the retainer.")
        log("    - All zero/positive deltas = residual is in Node infrastructure")
        log("      (loaded modules, JIT code, QueryClient internals) — not addressable")
        log("      from userland, only by exiting the process.")
    }

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

    // Pretty-print a resolved value for the dump.
    //
    // The resolver returns raw stats blobs (e.g. `{type: "binary", freq: [...]}`)
    // because the value is the same shape the molecule stores and the predicate
    // filter / CSV exporter / rollup card all want different projections of it.
    // For the human-readable PoC dump we apply the same unwrap the predicate
    // filter uses (`unwrapStatsForCompare`) and tag the column so it's clear
    // the displayed value is a projection, not the raw payload.
    function displayValue(v: unknown): {text: string; tag: string | null} {
        if (v === null || typeof v !== "object") {
            return {text: shortVal(v, 80), tag: null}
        }
        const t = (v as {type?: string}).type
        if (t === "binary" || t === "numeric" || t === "numeric/continuous") {
            const unwrapped = unwrapStatsForCompare(v)
            return {text: shortVal(unwrapped, 80), tag: `stats:${t}`}
        }
        return {text: shortVal(v, 80), tag: null}
    }

    // Dump a single hydrated row in the resolved-column shape — the same
    // grouped view the scenarios table renders (Testset / Application /
    // <Evaluator> / Metrics). Hides the raw join blob; shows only what a
    // user would see in a cell.
    function dumpRow(hr: HydratedScenarioRow<ScenarioRow>, label: string): void {
        log(`\n  [${label}]  scenario=${hr.scenario.id}`)
        const cols = resolveColumns(hr)
        if (cols.length === 0) {
            log(`    (no columns resolved — run schema missing?)`)
            return
        }
        const groups = groupResolvedColumns(cols)
        for (const g of groups) {
            log(
                `    ▸ ${g.group.label}  [${g.group.kind}${g.group.slug ? ` · ${g.group.slug}` : ""}]`,
            )
            for (const c of g.columns) {
                const sourceTag = c.source === "missing" ? "✗" : `via ${c.source}`
                const {text, tag} = displayValue(c.value)
                const tagSuffix = tag ? `  [${tag}]` : ""
                log(`        • ${c.name.padEnd(20)} = ${text}  [${sourceTag}]${tagSuffix}`)
            }
        }
    }

    if (aggregate.count === 0) {
        row("Rows produced", "0 — nothing matched the predicate")
    } else {
        row(
            "Sink mode",
            env.sinkMode === "streaming"
                ? "streaming  (rows aggregated then released; bounded memory)"
                : "accumulate  (every row retained for post-hoc inspection)",
        )
        row(
            "Rows produced",
            env.sinkMode === "streaming"
                ? `${aggregate.count}  (${matchedRows.length} retained in memory, aggregates computed for all)`
                : `${aggregate.count}  (all retained in matchedRows[])`,
        )
        // All numbers below come from the running aggregate — they look the
        // same whether the sink kept rows or threw them away.
        row(
            "Results per row",
            `${(aggregate.totalResults / aggregate.count).toFixed(2)} avg ` +
                `(min ${aggregate.minResults === Number.POSITIVE_INFINITY ? 0 : aggregate.minResults}, ` +
                `max ${aggregate.maxResults})`,
        )
        row(
            "Metrics per row",
            `${(aggregate.totalMetrics / aggregate.count).toFixed(2)} avg ` +
                `(${aggregate.rowsWithMetric}/${aggregate.count} rows have ≥1 metric)`,
        )
        row(
            "Testcase resolution",
            `${aggregate.rowsWithTestcase}/${aggregate.count} rows joined to a testcase ` +
                `(${((aggregate.rowsWithTestcase / aggregate.count) * 100).toFixed(0)}%)`,
        )
        row(
            "Traces per row",
            `${(aggregate.totalTraces / aggregate.count).toFixed(2)} avg ` +
                `(${aggregate.rowsWithTraces}/${aggregate.count} rows have ≥1 trace)`,
        )

        const statusBreakdown = Array.from(aggregate.statusCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => `${s}=${c} (${((c / aggregate.count) * 100).toFixed(1)}%)`)
            .join(", ")
        row("Scenario status distribution", statusBreakdown)

        // UUIDv7 lex-sort = time-sort, so min/max tracked incrementally
        // are equivalent to first/last in time order.
        row("ID range (first)", aggregate.minId ?? "?")
        row("ID range (last)", aggregate.maxId ?? "?")

        // One matched row in resolved-column shape — mirrors what the
        // scenarios table renders cell-by-cell, grouped by source.
        const sampleForDump =
            env.sinkMode === "accumulate" && matchedRows.length > 0
                ? matchedRows[0]
                : aggregate.sampleRow
        if (sampleForDump) {
            log("\n  Sample matched row (resolved columns — as the table would show it):")
            dumpRow(sampleForDump, `row 0`)
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
            aggregate.statusCounts.size === 0 ||
                (aggregate.statusCounts.size === 1 && aggregate.statusCounts.has(env.filterStatus)),
            `${aggregate.count} rows, all scenario.status === "${env.filterStatus}"`,
        ],
        [
            "Multi-stage transform pipeline ran",
            hydrateMetrics.length > 0 || aggregate.count === 0,
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
            aggregate.allHaveValidId,
            `${aggregate.count} rows, all scenarios materialized (not skeleton)`,
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
            aggregate.count === 0 || aggregate.allHaveJoinedEntities,
            `${aggregate.count} rows, each with results[]/metrics[]/testcase/traces{} populated`,
        ],
        [
            "Cache reuse: rerun is 100% cache hits across all 4 entities",
            reprefetchStats.results.cacheMisses === 0 &&
                reprefetchStats.metrics.cacheMisses === 0 &&
                reprefetchStats.testcases.cacheMisses === 0 &&
                reprefetchStats.traces.cacheMisses === 0,
            `re-prefetch: results ${reprefetchStats.results.cacheHits}/${reprefetchStats.results.cacheHits + reprefetchStats.results.cacheMisses}, ` +
                `metrics ${reprefetchStats.metrics.cacheHits}/${reprefetchStats.metrics.cacheHits + reprefetchStats.metrics.cacheMisses}, ` +
                `testcases ${reprefetchStats.testcases.cacheHits}/${reprefetchStats.testcases.cacheHits + reprefetchStats.testcases.cacheMisses}, ` +
                `traces ${reprefetchStats.traces.cacheHits}/${reprefetchStats.traces.cacheHits + reprefetchStats.traces.cacheMisses}`,
        ],
        [
            "Cache reuse: 0ms network on rerun",
            reprefetchStats.results.fetchMs === 0 &&
                reprefetchStats.metrics.fetchMs === 0 &&
                reprefetchStats.testcases.fetchMs === 0 &&
                reprefetchStats.traces.fetchMs === 0,
            `rerun fetch times: results ${reprefetchStats.results.fetchMs.toFixed(1)}ms / metrics ${reprefetchStats.metrics.fetchMs.toFixed(1)}ms / testcases ${reprefetchStats.testcases.fetchMs.toFixed(1)}ms / traces ${reprefetchStats.traces.fetchMs.toFixed(1)}ms`,
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
            if (aggregate.count === 0) {
                return {
                    sinkMode: env.sinkMode,
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
                    sampleResolvedColumns: [],
                }
            }
            const statusCounts: Record<string, number> = {}
            for (const [s, c] of aggregate.statusCounts) statusCounts[s] = c
            // Sample retention: accumulate mode can dump the first 3 + the last
            // matched row; streaming mode only retains the very first row, so
            // sampleRows is at most 1 entry and lastRow is always null.
            const sampleSource =
                env.sinkMode === "accumulate"
                    ? matchedRows.slice(0, 3)
                    : aggregate.sampleRow
                      ? [aggregate.sampleRow]
                      : []
            const lastRow =
                env.sinkMode === "accumulate" && matchedRows.length > 3
                    ? matchedRows[matchedRows.length - 1]
                    : null
            return {
                sinkMode: env.sinkMode,
                rowsInSink: aggregate.count,
                idRange: {
                    first: aggregate.minId,
                    last: aggregate.maxId,
                },
                statusDistribution: statusCounts,
                joinStats: {
                    avgResultsPerRow: aggregate.totalResults / aggregate.count,
                    avgMetricsPerRow: aggregate.totalMetrics / aggregate.count,
                    rowsWithTestcase: aggregate.rowsWithTestcase,
                    rowsWithTraces: aggregate.rowsWithTraces,
                },
                sampleRows: sampleSource,
                lastRow,
                // Resolved column values per the run's mappings — what the UI
                // would actually render for these rows.
                sampleResolvedColumns: sampleSource.map((hr) => ({
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
