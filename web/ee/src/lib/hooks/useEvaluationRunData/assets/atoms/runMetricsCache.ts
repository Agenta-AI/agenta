import deepEqual from "fast-deep-equal"
import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"

import {getCurrentProject} from "@/oss/contexts/project.context"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {getAgentaApiUrl} from "@/oss/lib/helpers/utils"
import {slugify} from "@/oss/lib/utils/slugify"
import {fetchRunMetricsViaWorker} from "@/agenta-oss-common/lib/workers/evalRunner/runMetricsWorker"
import {getJWT} from "@/oss/services/api"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import {evaluationRunIdAtom} from "./derived"
import {evaluationRunStateAtom} from "./evaluationRunStateAtom"

import {evalAtomStore, loadingStateAtom} from "."

// Signal atom – increment to force refetch of run metrics
export const runMetricsRefreshAtom = atom(0)

// Simple in-memory caches
export const runMetricsCacheAtom = atom<Map<string, any[]>>(new Map())
export const runMetricsStatsCacheAtom = atom<Map<string, Record<string, BasicStats>>>(new Map())

// Deduplicate inflight requests per runId
const inFlight = new Map<string, Promise<void>>()

const runFetchMetrics = async (
    store: any,
    runId: string,
    evaluatorSlugs: string[] = [],
    revisionSlugs: string[] = [],
) => {
    if (inFlight.has(runId)) return inFlight.get(runId)! as Promise<void>
    const promise = (async () => {
        evalAtomStore().set(loadingStateAtom, (draft) => {
            draft.isLoadingMetrics = true
        })
        try {
            const apiUrl = getAgentaApiUrl()
            const jwt = await getJWT()
            const proj = getCurrentProject() as any
            const projectId = (proj?.id ?? proj?.projectId ?? "") as string

            if (!projectId || !jwt || !apiUrl) {
                throw new Error("Project ID, JWT or API URL not found")
            }

            const {metrics, stats} = await fetchRunMetricsViaWorker(runId, {
                apiUrl,
                jwt,
                projectId,
                evaluatorSlugs,
                revisionSlugs,
            })
            const camelMetrics = Array.isArray(metrics)
                ? metrics.map((m: any) => snakeToCamelCaseKeys(m))
                : []
            evalAtomStore().set(runMetricsCacheAtom, (prev) => {
                const next = new Map(prev)
                next.set(runId, camelMetrics)
                return next
            })
            evalAtomStore().set(runMetricsStatsCacheAtom, (prev) => {
                const next = new Map(prev)
                next.set(runId, stats || {})
                return next
            })
            // reset refresh counter back to 0
            store.set(runMetricsRefreshAtom, 0)
        } catch (err) {
            console.log("error with fetching metrics", err)
        } finally {
            inFlight.delete(runId) // ✔ cleanup
            evalAtomStore().set(loadingStateAtom, (draft) => {
                draft.isLoadingMetrics = false
            })
        }
    })()
    inFlight.set(runId, promise)
    return promise
}

export const runMetricsAtom = eagerAtom<any[]>((get) => {
    const runId = get(evaluationRunIdAtom)
    if (!runId) return []
    // depend on refresh signal
    const refresh = get(runMetricsRefreshAtom)

    const cache = get(runMetricsCacheAtom)
    const cached = cache.get(runId)

    // ─── Normal path: no refresh requested ───────────────────────
    if (refresh === 0) return cached || []

    // ─── Refresh requested (stale-while-revalidate) ───────────────
    if (cached) {
        // Kick off background revalidation if not already running
        if (!inFlight.has(runId)) {
            runFetchMetrics(evalAtomStore(), runId)
        }
        return cached // serve stale data while revalidating
    }

    // No cached data → fall back to Suspense/async path
    if (inFlight.has(runId)) throw inFlight.get(runId)!

    const p = runFetchMetrics(evalAtomStore(), runId)
    inFlight.set(runId, p)
    throw p
})

// Helper write-only atom to invalidate + refetch
// Aggregated stats per metric key for current run
// Map of scenarioId -> flat metrics object for quick access
const scenarioMetricsCache = new WeakMap<any[], Record<string, Record<string, any>>>()
export const scenarioMetricsMapAtom = eagerAtom<Record<string, Record<string, any>>>((get) => {
    const arr = get(runMetricsAtom) as any[]
    if (!arr) return {}
    const cached = scenarioMetricsCache.get(arr)
    if (cached) return cached
    const map: Record<string, Record<string, any>> = {}
    arr.forEach((entry: any) => {
        const sid = entry?.scenarioId || entry?.scenario_id || entry?.scenarioID || entry?.id
        if (!sid) return
        map[String(sid)] = entry?.data || {}
    })
    scenarioMetricsCache.set(arr, map)
    return map
})

// Helper: flatten acc object and nested metrics similar to legacy mergedMetricsAtom
export function flattenMetrics(raw: Record<string, any>): Record<string, any> {
    const flat: Record<string, any> = {}
    Object.entries(raw || {}).forEach(([k, v]) => {
        if (k === "acc" && v && typeof v === "object") {
            const acc: any = v
            if (acc?.costs?.total !== undefined) flat.totalCost = acc.costs.total
            if (acc?.duration?.total !== undefined)
                flat["duration.total"] = Number((acc.duration.total / 1000).toFixed(6))
            if (acc?.tokens?.total !== undefined) flat.totalTokens = acc.tokens.total
            if (acc?.tokens?.prompt !== undefined) flat.promptTokens = acc.tokens.prompt
            if (acc?.tokens?.completion !== undefined) flat.completionTokens = acc.tokens.completion
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
            Object.entries(v).forEach(([sub, sv]) => {
                flat[`${k}.${sub}`] = sv
            })
        } else {
            flat[k] = v
        }
    })
    return flat
}

// Atom family: returns metric map for a single scenario (stable ref while unchanged)
export const scenarioMetricMapFamily = atomFamily((scenarioId: string) =>
    selectAtom(
        scenarioMetricsMapAtom,
        (raw) => {
            const map = raw as Record<string, Record<string, any>>
            return map[scenarioId] ?? {}
        },
        deepEqual,
    ),
)

// Flattened variant used by UI
export const scenarioFlatMetricMapFamily = atomFamily((scenarioId: string) =>
    selectAtom(
        scenarioMetricMapFamily(scenarioId),
        (raw) => flattenMetrics(raw as Record<string, any>),
        deepEqual,
    ),
)

// Atom family to read a single metric value for a scenario without triggering full re-renders
export const scenarioMetricValueFamily = atomFamily(
    ({scenarioId, metricKey}: {scenarioId: string; metricKey: string}) =>
        selectAtom(
            scenarioMetricMapFamily(scenarioId),
            (m) => {
                return m[metricKey]
            },
            deepEqual,
        ),
)

// Atom family to read stats for a single metric path
export const runMetricStatsFamily = atomFamily((metricPath: string) =>
    selectAtom(
        runMetricsStatsAtom,
        (raw) => {
            const obj = raw as Record<string, BasicStats>
            const s = obj[metricPath]
            if (!s) return s
            if (s.binSize === undefined && s.distribution && s.distribution.length) {
                // lazily compute binSize similar to metricDistributionsAtom
                const bins = s.distribution.length
                const range = (s.max ?? 0) - (s.min ?? 0)
                return {
                    ...s,
                    binSize: bins ? (range !== 0 ? range / bins : 1) : 1,
                }
            }
            return s
        },
        deepEqual,
    ),
)

// Convenience family: returns { value, distInfo } for a metric key on a scenario
export const metricDataFamily = atomFamily(
    ({
        scenarioId,
        stepSlug,
        metricKey,
    }: {
        scenarioId: string
        stepSlug?: string
        metricKey: string
    }) =>
        eagerAtom<{value: any; distInfo?: BasicStats}>((get) => {
            const metricPath = stepSlug ? `${stepSlug}.${metricKey}` : metricKey
            const value = get(scenarioMetricValueFamily({scenarioId, metricKey: metricPath}))
            const distInfo = get(runMetricStatsFamily(metricPath))
            return {value, distInfo}
        }),
)

export const runMetricsStatsAtom = eagerAtom<Record<string, BasicStats>>((get) => {
    const runId = get(evaluationRunIdAtom)
    if (!runId) return {}
    // depend on refresh signal to re-evaluate when data arrives
    get(runMetricsRefreshAtom)
    const statsCache = get(runMetricsStatsCacheAtom)
    return statsCache.get(runId) || {}
})

// Subscription helper – attach once per store to auto-fetch when runId changes
export function attachRunMetricsPrefetch(store: ReturnType<typeof import("jotai").createStore>) {
    const fetched = new Set<string>()
    store.sub(evaluationRunStateAtom, () => {
        const state = store.get(evaluationRunStateAtom)
        const runId = (state?.rawRun as any)?.id ?? ""
        if (!runId || fetched.has(runId)) return
        if (!state?.enrichedRun?.evaluators) return // wait until evaluators
        fetched.add(runId)

        const evaluatorSlugs: string[] = Object.values(state.enrichedRun.evaluators || {}).map(
            (e: any) => e.slug,
        )
        const revisionSlugs: string[] = (state.enrichedRun.variants || []).map((rev: any) =>
            slugify(rev?.name ?? rev, rev.id),
        )
        const cache = store.get(runMetricsCacheAtom)
        if (cache.has(runId)) return
        runFetchMetrics(store, runId, evaluatorSlugs, revisionSlugs)
    })
}

export const invalidateRunMetricsAtom = atom(null, (get, set) => {
    const runId = get(evaluationRunIdAtom)
    if (!runId) return
    set(runMetricsRefreshAtom, (v) => v + 1)

    runFetchMetrics(evalAtomStore(), runId)
})
