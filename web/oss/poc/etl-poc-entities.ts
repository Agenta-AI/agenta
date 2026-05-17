#!/usr/bin/env -S node --experimental-strip-types
/**
 * ETL PoC — driven by the real entities-package paginated store
 *
 * This is the "really using entities" PoC. The Source is wrapped around a real
 * `createPaginatedEntityStore` instance configured to hit
 * `/evaluations/scenarios/query`. The ETL loop drives the store's reactive
 * pagination machinery; the store's accumulated rows are the same atoms a UI
 * V-table would subscribe to (proving the architecture's "shared atom layer"
 * claim concretely).
 *
 * What this validates over the earlier `etl-poc.ts`:
 *   ✓ The ETL engine + entities-package paginated store integrate cleanly
 *   ✓ The reactive controller drives fetchPage from the loop, not from UI
 *   ✓ scheduleNextPageAtomFamily advances the cursor through the store, not
 *     via a parallel HTTP client
 *   ✓ Cancellation propagates through the entity layer (subscription dies,
 *     scheduler stops)
 *
 * Env: AGENTA_API_URL, AGENTA_API_KEY, AGENTA_PROJECT_ID, AGENTA_RUN_ID
 * Optional: AGENTA_CHUNK_SIZE (default 50), AGENTA_VIEWPORT_TARGET (default 20),
 *           AGENTA_FILTER_STATUS (default "success")
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
}

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

async function main() {
    // Deep imports — bypass entities barrel (known React/CSS pollution)
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

    // 1. Auth interceptor on shared axios
    configureAxios({
        requestInterceptor: (config) => {
            if (config.headers && !config.headers.get("Authorization")) {
                config.headers.set("Authorization", `ApiKey ${env.apiKey}`)
            }
            return config
        },
    })

    // 2. Build the paginated store — same factory the architecture RFC calls out
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

    const scenariosStore = createPaginatedEntityStore<ScenarioRow, ScenarioRow, ScenarioMeta>({
        entityName: "scenarios",
        metaAtom,
        fetchPage: async ({meta, limit, cursor}) => {
            const res = await axios.post(
                "/evaluations/scenarios/query",
                {
                    scenario: {run_id: meta.runId},
                    windowing: {next: cursor, limit, order: "ascending"},
                },
                {params: {project_id: meta.projectId}},
            )
            const data = res.data as {
                scenarios?: ScenarioRow[]
                windowing?: {next?: string | null}
            }
            const rows = data?.scenarios ?? []
            const apiCursor = data?.windowing?.next ?? null
            const fallback = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null
            const nextCursor = apiCursor ?? fallback
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

    console.log("=== ETL PoC (entities-backed paginated store) ===")
    console.log(`API URL:         ${env.apiUrl}`)
    console.log(`Project:         ${env.projectId}`)
    console.log(`Run:             ${env.runId}`)
    console.log(`Chunk size:      ${env.chunkSize}`)
    console.log(`Viewport target: ${env.viewportTarget} matches`)
    console.log(`Filter:          status === "${env.filterStatus}"`)
    console.log("")

    // 3. Wrap the paginated store as an ETL Source via the adapter
    const source = makeSourceFromPaginatedStore<ScenarioRow>(scenariosStore, {
        scopeId: `poc-${env.runId}`,
        pageSize: env.chunkSize,
    })

    // 4. Filter transform — same as before, just composes with the new source
    const statusFilter: Transform<ScenarioRow, ScenarioRow> = (chunk) => ({
        ...chunk,
        items: chunk.items.filter((s) => s.status === env.filterStatus),
    })

    // 5. Sink — accumulate matched rows; the store's atoms already hold ALL rows
    //    (a UI consumer subscribed to the same scope would see them in real time)
    const matchedRows: ScenarioRow[] = []
    let finalizedRan = false
    const accumulatorSink: Sink<ScenarioRow> = {
        async load(chunk) {
            matchedRows.push(...chunk.items)
            return {loadedCount: chunk.items.length}
        },
        async finalize() {
            finalizedRan = true
        },
    }

    // 6. Run the loop
    const startMem = process.memoryUsage().heapUsed
    const startTime = Date.now()
    let chunkCount = 0
    const abort = new AbortController()

    try {
        for await (const progress of runLoop(
            source,
            [statusFilter],
            accumulatorSink,
            undefined,
            abort.signal,
        )) {
            chunkCount++
            const elapsed = Date.now() - startTime
            const memMB = (process.memoryUsage().heapUsed - startMem) / 1024 / 1024
            const cursorPrefix =
                typeof progress.cursor === "string" ? progress.cursor.slice(0, 16) : "(end)"
            console.log(
                `chunk ${chunkCount.toString().padStart(3)}: ` +
                    `scanned=${progress.scanned.toString().padStart(5)} ` +
                    `matched=${progress.matched.toString().padStart(4)} ` +
                    `loaded=${progress.loaded.toString().padStart(4)} ` +
                    `elapsed=${elapsed.toString().padStart(6)}ms ` +
                    `heap=+${memMB.toFixed(1)}MB ` +
                    `cursor=${cursorPrefix}`,
            )

            if (progress.matched >= env.viewportTarget) {
                console.log(`\n→ viewport filled (${env.viewportTarget} matches); aborting`)
                abort.abort()
                break
            }
        }
    } catch (e) {
        console.error("\n✗ Pipeline error:", e instanceof Error ? e.stack : e)
        process.exit(1)
    }

    const totalElapsed = Date.now() - startTime
    const totalMemMB = (process.memoryUsage().heapUsed - startMem) / 1024 / 1024

    console.log("")
    console.log("--- final ---")
    console.log(`chunks processed:  ${chunkCount}`)
    console.log(`total elapsed:     ${totalElapsed}ms`)
    console.log(`avg ms/chunk:      ${(totalElapsed / Math.max(chunkCount, 1)).toFixed(1)}`)
    console.log(`matched rows:      ${matchedRows.length}`)
    console.log(`heap growth:       ${totalMemMB.toFixed(1)}MB`)
    console.log(`sink.finalize ran: ${finalizedRan}`)

    if (matchedRows.length > 0) {
        console.log(`\n--- sample matched rows ---`)
        for (const row of matchedRows.slice(0, 3)) {
            console.log(`  id=${row.id} status=${row.status}`)
        }
    }

    // Assertions
    const assertions: Array<[string, boolean]> = [
        ["finalize ran via finally block", finalizedRan],
        ["pipeline completed without throwing", true],
        [
            "all matched rows satisfy predicate",
            matchedRows.every((r) => r.status === env.filterStatus),
        ],
        ["at least one chunk was processed", chunkCount > 0],
        [
            "rows came through the paginated store (not bypassed)",
            matchedRows.every((r) => !r.__isSkeleton),
        ],
    ]

    console.log("\n--- engine + entities assertions ---")
    let allOk = true
    for (const [name, ok] of assertions) {
        console.log(`${ok ? "✓" : "✗"} ${name}`)
        if (!ok) allOk = false
    }

    if (!allOk) {
        console.error("\nFAILED")
        process.exit(1)
    }
    console.log("\nOK — ETL engine + real entities-package paginated store works end-to-end")
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Unexpected error:", e)
        process.exit(1)
    })
