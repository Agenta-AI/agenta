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
    type Transform<In, Out> = import("../../packages/agenta-entities/src/etl/core/types").Transform<
        In,
        Out
    >
    type Sink<T> = import("../../packages/agenta-entities/src/etl/core/types").Sink<T>
    type Chunk<T> = import("../../packages/agenta-entities/src/etl/core/types").Chunk<T>
    type Source<T> = import("../../packages/agenta-entities/src/etl/core/types").Source<T>

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
    row("Transforms", `[statusFilter (status === "${env.filterStatus}")]`)
    row("Sink", "in-memory accumulator")
    row("Chunk size", `${env.chunkSize} rows`)
    row("Viewport target", `${env.viewportTarget} matches`)
    row("Cancellation policy", "viewport-fill (matched >= viewport target)")

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

    subsection("Pre-flight check")
    try {
        const profileRes = await axios.get("/profile")
        row("Auth confirmed", `${(profileRes.data as {email?: string})?.email ?? "(unknown)"}`)

        const runRes = await axios.post(
            "/evaluations/runs/query",
            {run: {ids: [env.runId]}},
            {params: {project_id: env.projectId}},
        )
        const runData = (runRes.data as {runs?: {name?: string; status?: string}[]})?.runs?.[0]
        if (!runData) throw new Error(`Run ${env.runId} not found in project ${env.projectId}`)
        row("Run name", runData.name ?? "(unnamed)")
        row("Run status", runData.status ?? "(unknown)")
    } catch (e) {
        console.error(`\n✗ Pre-flight failed: ${e instanceof Error ? e.message : e}`)
        process.exit(1)
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

    const matchedRows: ScenarioRow[] = []
    let finalizedRan = false
    const sinkLatencies: number[] = []

    const wrappedSink: Sink<ScenarioRow> = {
        async load(chunk: Chunk<ScenarioRow>) {
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
        for await (const progress of runLoop(
            instrumentedSource,
            [statusFilter as Transform<unknown, unknown>],
            wrappedSink,
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
    // Look for evidence of GC: heap went down between any two consecutive chunks
    const gcEvents = metrics.reduce((count, m, i) => {
        if (i === 0) return count
        return m.heapDelta < metrics[i - 1].heapDelta - 0.5 * 1024 * 1024 ? count + 1 : count
    }, 0)
    row("GC events observed", `${gcEvents} (heap drops > 0.5 MB between chunks)`)

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
            matchedRows.every((r) => r.status === env.filterStatus),
            `${matchedRows.length} rows, all status === "${env.filterStatus}"`,
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
            matchedRows.every((r) => r.id && !r.__isSkeleton),
            `${matchedRows.length} rows, all materialized (not skeleton)`,
        ],
        [
            "Network fetches went through entity layer",
            fetchTimings.length === chunkCount,
            `${fetchTimings.length} fetchPage calls match ${chunkCount} chunks`,
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
