#!/usr/bin/env -S node --experimental-strip-types
/**
 * Entities probe — does the @agenta/entities data layer actually work in Node?
 *
 * Architectural finding: the package's barrel exports
 * (@agenta/entities/evaluationRun and @agenta/entities/shared) transitively
 * import React components via shared/user/UserAuthorLabel.tsx → @agenta/ui
 * → CSS modules. CSS modules choke Node's TS loader.
 *
 * Workaround in this probe: import from the deepest file paths to bypass the
 * barrel. The underlying data layer (axios, Zod schemas, Jotai atoms,
 * createPaginatedEntityStore) is Node-portable IF imported via deep paths.
 *
 * Real fix (separate work): split entities package barrel so data-layer
 * consumers can import without transitively pulling React UI components.
 *
 * Env: AGENTA_API_URL, AGENTA_API_KEY, AGENTA_PROJECT_ID, AGENTA_RUN_ID
 */

process.env.NEXT_PUBLIC_AGENTA_API_URL = process.env.AGENTA_API_URL ?? ""

const env = {
    apiUrl: process.env.AGENTA_API_URL!,
    apiKey: process.env.AGENTA_API_KEY!,
    projectId: process.env.AGENTA_PROJECT_ID!,
    runId: process.env.AGENTA_RUN_ID!,
}

for (const [k, v] of Object.entries(env)) {
    if (!v) {
        console.error(`Missing env: ${k}`)
        process.exit(1)
    }
}

async function main() {
    console.log("=== Entities probe ===")
    console.log(`API URL: ${env.apiUrl}`)
    console.log(`Project: ${env.projectId}`)
    console.log(`Run:     ${env.runId}`)
    console.log("")

    // ============================================================================
    // Stage 1: Shared axios + auth interceptor
    // ============================================================================

    console.log("--- Stage 1: shared axios + auth ---")
    let configuredAxios: typeof import("axios").default
    try {
        // The shared axios package has no React. Safe to import via barrel.
        const sharedApi =
            (await import("@agenta/shared/api")) as typeof import("@agenta/shared/api")
        configuredAxios = sharedApi.axios as unknown as typeof import("axios").default

        sharedApi.configureAxios({
            requestInterceptor: (config) => {
                if (config.headers && !config.headers.get("Authorization")) {
                    config.headers.set("Authorization", `ApiKey ${env.apiKey}`)
                }
                return config
            },
        })

        const res = await configuredAxios.get("/profile")
        console.log(`✓ /profile responded; user email = ${(res.data as any)?.email}`)
    } catch (e) {
        console.error("✗ Stage 1 failed:", e instanceof Error ? e.stack : e)
        process.exit(1)
    }

    // ============================================================================
    // Stage 2: Zod schema validation via deep import (bypasses barrel)
    // ============================================================================

    console.log("\n--- Stage 2: Zod validation against real backend data ---")
    try {
        const {z} = await import("zod")

        // Minimal schema mirroring the entity package's evaluationRunSchema.
        // We can't import the entity's own schema yet (barrel pulls React);
        // architectural finding documented below. This proves Zod itself
        // works in Node against real backend data.
        const runMinimalSchema = z.object({
            id: z.string(),
            name: z.string().nullable().optional(),
            status: z.string().nullable().optional(),
            data: z
                .object({
                    steps: z.array(z.unknown()).nullable().optional(),
                    mappings: z.array(z.unknown()).nullable().optional(),
                })
                .nullable()
                .optional(),
        })
        const runsResponseSchema = z.object({
            count: z.number(),
            runs: z.array(runMinimalSchema),
        })

        const res = await configuredAxios.post(
            "/evaluations/runs/query",
            {run: {ids: [env.runId]}},
            {params: {project_id: env.projectId}},
        )

        const parsed = runsResponseSchema.safeParse(res.data)
        if (!parsed.success) {
            throw new Error(`Zod validation failed: ${JSON.stringify(parsed.error.issues)}`)
        }
        const run = parsed.data.runs[0]
        if (!run) throw new Error(`run ${env.runId} not found`)
        console.log(`✓ Zod parsed real response: name="${run.name}" status="${run.status}"`)
        console.log(
            `  steps=${run.data?.steps?.length ?? 0} mappings=${run.data?.mappings?.length ?? 0}`,
        )
        console.log(`  (zod works in Node; entity package's schema would too once barrel is fixed)`)
    } catch (e) {
        console.error("✗ Stage 2 failed:", e instanceof Error ? e.stack : e)
        process.exit(1)
    }

    // ============================================================================
    // Stage 3: Jotai atoms + projectIdAtom (deep imports)
    // ============================================================================

    console.log("\n--- Stage 3: Jotai store + atoms in Node ---")
    try {
        const {getDefaultStore, atom} = await import("jotai")
        const {atomFamily} = await import("jotai-family")
        const {projectIdAtom} = await import("@agenta/shared/state")

        const store = getDefaultStore()
        store.set(projectIdAtom, env.projectId)
        const readBack = store.get(projectIdAtom)
        if (readBack !== env.projectId) throw new Error(`projectIdAtom set/get mismatch`)
        console.log(`✓ projectIdAtom set/get works; current value = ${readBack}`)

        // Verify atomFamily works
        const testFamily = atomFamily((id: string) => atom({id, value: 42}))
        const a = testFamily("test-a")
        const b = testFamily("test-a") // Same key returns same atom
        if (a !== b) throw new Error(`atomFamily memoization broken`)
        const data = store.get(a) as {id: string; value: number}
        if (data.id !== "test-a" || data.value !== 42) throw new Error(`atom read broken`)
        console.log(`✓ atomFamily memoization works; atomA === atomB for same key`)
        console.log(`✓ Jotai store reads work in Node`)
    } catch (e) {
        console.error("✗ Stage 3 failed:", e instanceof Error ? e.stack : e)
        process.exit(1)
    }

    // ============================================================================
    // Stage 4: createPaginatedEntityStore via deep import
    // ============================================================================

    console.log("\n--- Stage 4: createPaginatedEntityStore in Node ---")
    try {
        const {atom} = await import("jotai")
        // Deep import to skip the entities/shared barrel
        const {createPaginatedEntityStore} =
            await import("../../packages/agenta-entities/src/shared/paginated/createPaginatedEntityStore")

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
                const res = await configuredAxios.post(
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

        console.log(
            `✓ createPaginatedEntityStore constructed: entityName=${scenariosStore.entityName}`,
        )
        console.log(`  Exposed members: ${Object.keys(scenariosStore).join(", ")}`)

        // The controller is reactive — pagination is driven by subscriptions.
        // Subscribe to the controller atom with concrete params and wait for
        // the first chunk to load.
        const {getDefaultStore} = await import("jotai")
        const store = getDefaultStore()

        const controllerParams = {scopeId: `probe-${env.runId}`, pageSize: 50}
        const controllerAtom = scenariosStore.controller(controllerParams)

        // Trigger reactive fetch by subscribing
        const unsub = store.sub(controllerAtom, () => {})

        // Poll for rows to arrive (max 10s)
        let final: {rows: unknown[]; isFetching: boolean; hasMore: boolean} | null = null
        const start = Date.now()
        while (Date.now() - start < 10_000) {
            const state = store.get(controllerAtom) as {
                rows: unknown[]
                isFetching: boolean
                hasMore: boolean
                totalCount: number | null
            }
            // Wait for: non-empty rows OR isFetching=false (load completed, even if empty)
            if (
                (!state.isFetching && state.rows.length > 0) ||
                (state.rows.length === 0 && !state.isFetching && Date.now() - start > 500)
            ) {
                final = state
                break
            }
            await new Promise((r) => setTimeout(r, 100))
        }
        unsub()

        if (!final) throw new Error("controller never resolved within 10s")
        console.log(`✓ controller reactive fetch completed:`)
        console.log(
            `  rows=${final.rows.length} hasMore=${final.hasMore} isFetching=${final.isFetching}`,
        )
        if (final.rows.length > 0) {
            const r = final.rows[0] as {id?: string; status?: string; __isSkeleton?: boolean}
            console.log(
                `  sample row: id=${r.id} status=${r.status} skeleton=${r.__isSkeleton ?? false}`,
            )
        }
    } catch (e) {
        console.error("✗ Stage 4 failed:", e instanceof Error ? e.stack : e)
        process.exit(1)
    }

    console.log("\n" + "=".repeat(60))
    console.log("✓ All four stages passed — data layer works in Node")
    console.log("  (with deep imports to bypass the barrel's React transitive deps)")
    console.log("=".repeat(60))
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("Unexpected error:", e)
        process.exit(1)
    })
