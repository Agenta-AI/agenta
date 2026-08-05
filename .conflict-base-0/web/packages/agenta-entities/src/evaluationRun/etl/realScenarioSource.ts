/**
 * Real evaluation scenario source — hits the actual `/evaluations/scenarios/query`
 * endpoint and yields chunks of EvaluationScenario.
 *
 * This is the minimum-viable real source for the PoC. It deliberately does NOT:
 *   - Wrap createPaginatedEntityStore (that's Phase 2 of the integration)
 *   - Implement the correlatedDataPrefetch hook (that's Phase 1c of the architecture RFC)
 *   - Validate predicates against a FilterSchema (that's D4 of the filter RFC)
 *   - Plug into Jotai (that's not needed for headless validation)
 *
 * It DOES:
 *   - Hit the real Agenta API with proper auth
 *   - Honor the cursor pagination contract (windowing.next opaque string)
 *   - Yield chunks shaped like a real Source<EvaluationScenario>
 *   - Honor AbortSignal
 *
 * Use in headless scripts:
 *
 * ```ts
 * import {makeRealScenarioSource} from "@agenta/entities/evaluationRun/etl"
 *
 * const source = makeRealScenarioSource({
 *   baseUrl: process.env.AGENTA_API_URL!,
 *   apiKey: process.env.AGENTA_API_KEY!,
 *   projectId: process.env.AGENTA_PROJECT_ID!,
 *   runId: process.env.AGENTA_RUN_ID!,
 *   chunkSize: 200,
 * })
 *
 * for await (const chunk of source.extract(undefined, abort.signal)) {
 *   console.log(`${chunk.items.length} scenarios, next=${chunk.cursor}`)
 * }
 * ```
 *
 * @packageDocumentation
 */

import type {Source} from "../../etl/core/types"

/**
 * Minimal EvaluationScenario shape — what the API actually returns.
 * In Phase 2 of the architecture RFC, this gets a proper Zod schema and
 * lives in evaluationRun/core/schema.ts. For the PoC, this is enough.
 */
export interface RealEvaluationScenario {
    id: string
    status: string
    created_at?: string
    updated_at?: string
    testcase_id?: string | null
    timestamp?: string | null
    [k: string]: unknown
}

export interface RealScenarioSourceParams {
    /** Base URL of the Agenta API (e.g. http://localhost:8000) */
    baseUrl: string
    /** API key for Bearer auth */
    apiKey: string
    /** Project ID — sent as a query param */
    projectId: string
    /** Run ID — sent in the request body */
    runId: string
    /** Chunk size — sent as windowing.limit. Defaults to 200. */
    chunkSize?: number
    /** Ordering — "ascending" (default) or "descending" */
    order?: "ascending" | "descending"
}

interface ScenariosResponse {
    scenarios?: RealEvaluationScenario[]
    windowing?: {
        next?: string | null
        oldest?: string | null
        newest?: string | null
        limit?: number
        order?: string
    }
    [k: string]: unknown
}

/**
 * Factory for the real evaluation-scenarios Source. The source yields chunks
 * by repeatedly calling POST /evaluations/scenarios/query with the previous
 * response's windowing.next cursor.
 */
export function makeRealScenarioSource(
    params: RealScenarioSourceParams,
): Source<RealEvaluationScenario, undefined> {
    const {baseUrl, apiKey, projectId, runId, chunkSize = 200, order = "ascending"} = params
    const endpoint = `${baseUrl.replace(/\/$/, "")}/evaluations/scenarios/query`

    return {
        async *extract(_params, signal) {
            let cursor: string | null = null
            let chunkIdx = 0

            while (!signal.aborted) {
                const body = {
                    scenario: {run_id: runId},
                    windowing: {
                        next: cursor,
                        limit: chunkSize,
                        order,
                    },
                }

                const url = `${endpoint}?project_id=${encodeURIComponent(projectId)}`

                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        // Agenta accepts both "ApiKey <key>" and bare "<key>"; using the
                        // explicit prefix for clarity.
                        Authorization: `ApiKey ${apiKey}`,
                    },
                    body: JSON.stringify(body),
                    signal,
                })

                if (!res.ok) {
                    const text = await res.text()
                    throw new Error(
                        `scenarios/query failed: ${res.status} ${res.statusText} — ${text.slice(0, 200)}`,
                    )
                }

                const data: ScenariosResponse = await res.json()
                const items = Array.isArray(data?.scenarios) ? data.scenarios : []

                // Cursor resolution — three cases:
                //   1. Server returned a `windowing` object with `next: <string>`:
                //      authoritative — use it.
                //   2. Server returned `windowing: {next: null}` (or omitted next
                //      within a present windowing object): authoritative end-of-stream.
                //      Skip the heuristic fallback; no extra RTT.
                //   3. Server omitted `windowing` entirely (current local Agenta
                //      behavior for /evaluations/scenarios/query): we don't know.
                //      Use last-row-id heuristic when items.length === limit,
                //      matching the OSS fallback in fetchEvaluationScenarioWindow.
                //      Costs one extra RTT at end-of-stream (the "phantom chunk").
                const windowingPresent = data?.windowing !== undefined
                const apiNext = data?.windowing?.next ?? null
                const fallbackCursor =
                    items.length === chunkSize ? (items[items.length - 1]?.id ?? null) : null
                const next: string | null = windowingPresent
                    ? apiNext // Trust the server's explicit signal
                    : (apiNext ?? fallbackCursor) // Server doesn't provide windowing — heuristic

                // Also short-circuit if we got fewer rows than requested — definitive end
                const definitivelyExhausted = items.length < chunkSize
                const finalCursor: string | null = definitivelyExhausted ? null : next

                yield {
                    items,
                    cursor: finalCursor,
                    meta: {page: chunkIdx, hint: "real-scenarios"},
                }

                if (!finalCursor) return
                cursor = finalCursor
                chunkIdx++
            }
        },
    }
}
