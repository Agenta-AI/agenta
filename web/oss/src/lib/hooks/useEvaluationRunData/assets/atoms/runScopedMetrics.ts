import deepEqual from "fast-deep-equal"
import {Atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"
import {eagerAtom} from "jotai-eager"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {BasicStats, canonicalizeMetricKey, getMetricValueWithAliases} from "@/oss/lib/metricUtils"
import {slugify} from "@/oss/lib/utils/slugify"
import {getJWT} from "@/oss/services/api"
import {getProjectValues} from "@/oss/state/project"

import type {EvaluationRunState} from "../../types"

import {
    evaluationRunStateFamily,
    loadingStateFamily,
    runMetricsCacheFamily,
    runMetricsRefreshFamily,
    runMetricsStatsCacheFamily,
} from "./runScopedAtoms"
import {evalAtomStore} from "./store"

// Re-export the atom families for external use
export {runMetricsCacheFamily, runMetricsStatsCacheFamily}

import {fetchRunMetricsViaWorker} from "@/agenta-oss-common/lib/evalRunner/runMetricsWorker"

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

// Deduplicate inflight requests per runId
const inFlight = new Map<string, Promise<void>>()

const buildAnnotationSlugMap = (state?: EvaluationRunState): Record<string, string> => {
    if (!state?.runIndex?.steps) return {}

    const map: Record<string, string> = {}
    Object.values(state.runIndex.steps).forEach((meta: any) => {
        const key = meta?.key
        const slug = meta?.refs?.evaluator?.slug
        if (meta?.kind !== "annotation") return
        if (
            typeof key === "string" &&
            key.startsWith("evaluator-") &&
            typeof slug === "string" &&
            slug.length
        ) {
            map[key] = key
        }
    })

    return map
}

const runFetchMetrics = async (
    store: any,
    runId: string,
    evaluatorSlugs: string[] = [],
    revisionSlugs: string[] = [],
) => {
    if (inFlight.has(runId)) return inFlight.get(runId)! as Promise<void>

    const existingMetrics = (() => {
        try {
            const value = store?.get ? store.get(runMetricsCacheFamily(runId)) : []
            return Array.isArray(value) ? value : []
        } catch {
            return []
        }
    })()

    const hasCachedMetrics = existingMetrics.length > 0

    const promise = (async () => {
        evalAtomStore().set(loadingStateFamily(runId), (draft) => {
            if (hasCachedMetrics) {
                draft.isRefreshingMetrics = true
            } else {
                draft.isLoadingMetrics = true
            }
        })
        try {
            const state = store?.get ? store.get(evaluationRunStateFamily(runId)) : undefined

            const annotationSlugMap = buildAnnotationSlugMap(state)

            const effectiveEvaluatorSlugs =
                evaluatorSlugs.length > 0
                    ? evaluatorSlugs
                    : (() => {
                          if (!state?.enrichedRun?.evaluators) return []
                          const list = Array.isArray(state.enrichedRun.evaluators)
                              ? state.enrichedRun.evaluators
                              : Object.values(state.enrichedRun.evaluators)
                          return list
                              .map((ev: any) => ev?.slug || ev?.id || ev?.name)
                              .filter(Boolean) as string[]
                      })()

            const effectiveRevisionSlugs =
                revisionSlugs.length > 0
                    ? revisionSlugs
                    : (() => {
                          const revisions = state?.enrichedRun?.variants
                          if (!Array.isArray(revisions)) return []
                          return revisions
                              .map((v: any) => slugify(v?.name, v?.id))
                              .filter(Boolean) as string[]
                      })()

            const apiUrl = getAgentaApiUrl()
            const jwt = await getJWT()
            const proj = getProjectValues() as any
            const projectId = (proj?.id ?? proj?.projectId ?? "") as string

            if (!projectId || !jwt || !apiUrl) {
                console.error(`[runScopedMetrics] Missing context for runId: ${runId}`, {
                    hasProjectId: !!projectId,
                    hasJwt: !!jwt,
                    hasApiUrl: !!apiUrl,
                })
                throw new Error("Project ID, JWT or API URL not found")
            }

            const {metrics, stats} = await fetchRunMetricsViaWorker(runId, {
                apiUrl,
                jwt,
                projectId,
                evaluatorSlugs: effectiveEvaluatorSlugs,
                revisionSlugs: effectiveRevisionSlugs,
                annotationSlugMap,
            })

            const scenarioMetrics = Array.isArray(metrics) ? metrics : []

            // Update run-scoped cache atoms
            store.set(runMetricsCacheFamily(runId), scenarioMetrics)
            store.set(runMetricsStatsCacheFamily(runId), stats || {})

            // Reset refresh counter back to 0
            store.set(runMetricsRefreshFamily(runId), 0)
        } catch (err) {
            console.error(`[runScopedMetrics] Error fetching metrics for runId: ${runId}:`, err)
        } finally {
            inFlight.delete(runId) // cleanup
            evalAtomStore().set(loadingStateFamily(runId), (draft) => {
                draft.isLoadingMetrics = false
                draft.isRefreshingMetrics = false
            })
        }
    })()
    inFlight.set(runId, promise)
    return promise
}

// Run-scoped metrics atom family that fetches metrics for a specific runId
export const runMetricsFamily = atomFamily<string, Atom<any[]>>((runId: string) => {
    return eagerAtom<any[]>((get) => {
        if (!runId) {
            return []
        }

        // Depend on refresh signal
        const refresh = get(runMetricsRefreshFamily(runId))

        const cached = get(runMetricsCacheFamily(runId))

        // Normal path: no refresh requested
        if (refresh === 0) {
            return cached || []
        }

        // Refresh requested (stale-while-revalidate)
        if (cached && cached.length > 0) {
            // Kick off background revalidation if not already running
            if (!inFlight.has(runId)) {
                runFetchMetrics(evalAtomStore(), runId)
            }
            return cached // serve stale data while revalidating
        }

        // No cached data → start background fetch and return empty list (no suspense)
        if (!inFlight.has(runId)) {
            const state = get(evaluationRunStateFamily(runId))
            const evaluators = state?.enrichedRun?.evaluators
            if (!evaluators) return []

            // Handle both array and object formats
            const evaluatorsList = Array.isArray(evaluators)
                ? evaluators
                : Object.values(evaluators)

            const evaluatorSlugs = evaluatorsList.map((ev: any) => ev.slug || ev.id || ev.name)

            const revisions = state?.enrichedRun?.variants
            const revisionSlugs = revisions ? revisions.map((v: any) => slugify(v.name, v.id)) : []

            const p = runFetchMetrics(evalAtomStore(), runId, evaluatorSlugs, revisionSlugs)
            inFlight.set(runId, p)
        }
        return []
    })
}, deepEqual)

// Run-scoped scenario metrics map atom family
const scenarioMetricsCache = new WeakMap<any[], Record<string, Record<string, any>>>()

const normalizeStatValue = (value: any) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const next: any = {...value}

    if (Array.isArray(next.freq)) {
        next.frequency = next.freq
        delete next.freq
    }
    if (Array.isArray(next.uniq)) {
        next.unique = next.uniq
        delete next.uniq
    }

    if (Array.isArray(next.frequency)) {
        next.frequency = next.frequency.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))

        const sorted = [...next.frequency].sort(
            (a, b) => b.count - a.count || (a.value === true ? -1 : 1),
        )
        next.rank = sorted
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = sorted.map((entry) => entry.value)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
    }

    return next
}

export const scenarioMetricsMapFamily = atomFamily<
    string,
    Atom<Record<string, Record<string, any>>>
>((runId: string) => {
    return eagerAtom<Record<string, Record<string, any>>>((get) => {
        // Explicitly depend on refresh signal to ensure reactivity
        const refresh = get(runMetricsRefreshFamily(runId))

        const arr = get(runMetricsFamily(runId)) as any[]

        if (!arr) {
            return {}
        }

        const cached = scenarioMetricsCache.get(arr)
        if (cached && refresh === 0) {
            return cached
        }

        const map: Record<string, Record<string, any>> = {}
        arr.forEach((entry: any, index: number) => {
            const sid = entry?.scenarioId || entry?.scenario_id || entry?.scenarioID || entry?.id
            if (!sid) {
                return
            }
            // The data might already be processed/flattened or still nested
            const rawData = entry?.data || {}

            // Check if data is already flat (has direct metric values) or nested (has variant objects)
            const firstNonEmptyKey = Object.keys(rawData).find((key) => {
                const value = rawData[key]
                return (
                    value !== null &&
                    value !== undefined &&
                    (typeof value === "object" ? Object.keys(value).length > 0 : true)
                )
            })

            // If you want the first non-empty value:
            const firstValue = firstNonEmptyKey ? rawData[firstNonEmptyKey] : undefined
            const isAlreadyFlat =
                typeof firstValue === "number" ||
                (typeof firstValue === "object" && (firstValue?.mean || firstValue?.unique))

            if (isAlreadyFlat) {
                // Data is already flat, ensure canonical aliases are present
                const normalized: Record<string, any> = {...rawData}
                Object.keys(rawData).forEach((rawKey) => {
                    normalized[rawKey] = normalizeStatValue(normalized[rawKey])
                    const canonical = canonicalizeMetricKey(rawKey)
                    if (canonical !== rawKey && normalized[canonical] === undefined) {
                        normalized[canonical] = normalizeStatValue(rawData[rawKey])
                    }
                })
                map[String(sid)] = normalized
            } else {
                // Data is nested, process it
                const processedData: Record<string, any> = {}

                // Extract metrics from all variants (usually just one)
                Object.values(rawData).forEach((variantData: any) => {
                    if (variantData && typeof variantData === "object") {
                        Object.entries(variantData).forEach(
                            ([metricKey, metricValue]: [string, any]) => {
                                // Extract the mean value from metric objects like {"mean": 0.000059}
                                const value = metricValue?.mean ?? metricValue

                                // Apply key mapping for common metrics
                                let mappedKey = metricKey
                                if (metricKey === "costs.total") mappedKey = "totalCost"
                                else if (metricKey === "tokens.total") mappedKey = "totalTokens"
                                else if (metricKey === "tokens.prompt") mappedKey = "promptTokens"
                                else if (metricKey === "tokens.completion")
                                    mappedKey = "completionTokens"

                                const canonical = canonicalizeMetricKey(mappedKey)
                                processedData[mappedKey] = normalizeStatValue(value)
                                if (canonical !== mappedKey) {
                                    processedData[canonical] = processedData[canonical] ?? value
                                }
                            },
                        )
                    }
                })

                map[String(sid)] = processedData
            }
        })

        scenarioMetricsCache.set(arr, map)
        return map
    })
}, deepEqual)

/**
 * Run-scoped scenario metrics selector
 * Returns a single metric primitive for a given scenario without triggering wide re-renders.
 * Specialized for the case where you only need a single metric value. like table cells
 */
export const scenarioMetricSelectorFamily = atomFamily<
    {runId: string; scenarioId: string},
    Atom<Record<string, Record<string, any>>>
>(({runId, scenarioId}) => {
    return selectAtom(scenarioMetricsMapFamily(runId), (s) => s?.[scenarioId], deepEqual)
}, deepEqual)

const OUTPUT_PREFIX = "attributes.ag.data.outputs."
const METRICS_PREFIX = "attributes.ag.metrics."

const stripPrefixVariants = (value: string, ...prefixes: string[]): string => {
    let next = value
    prefixes.forEach((prefix) => {
        if (next.startsWith(prefix)) {
            next = next.slice(prefix.length)
        }
    })
    return next
}

const appendOutputCandidates = (
    push: (candidate?: string) => void,
    seed: string,
    slug?: string,
) => {
    if (!seed) return
    const tail = stripPrefixVariants(seed, OUTPUT_PREFIX, "outputs.")
    if (!tail) return
    push(`${OUTPUT_PREFIX}${tail}`)
    if (slug) {
        push(`${slug}.${OUTPUT_PREFIX}${tail}`)
        push(`${OUTPUT_PREFIX}${slug}.${tail}`)
    }
}

const appendMetricCandidates = (
    push: (candidate?: string) => void,
    seed: string,
    slug?: string,
) => {
    if (!seed) return
    const tail = stripPrefixVariants(seed, METRICS_PREFIX, "metrics.")
    if (!tail) return
    push(`${METRICS_PREFIX}${tail}`)
    if (slug) {
        push(`${slug}.${METRICS_PREFIX}${tail}`)
        push(`${METRICS_PREFIX}${slug}.${tail}`)
    }
}

/**
 * Run-scoped single metric value selector
 * Mirrors the legacy scenarioMetricValueFamily but adds runId and optional stepSlug support.
 * Returns a single metric primitive for a given scenario without triggering wide re-renders.
 */
export const scenarioMetricValueFamily = atomFamily(
    ({
        runId,
        scenarioId,
        metricKey,
        stepSlug,
    }: {
        runId: string
        scenarioId: string
        metricKey: string
        stepSlug?: string
    }) =>
        selectAtom(
            scenarioMetricsMapFamily(runId),
            (map) => {
                const metrics = map?.[scenarioId] || {}

                const buildCandidateKeys = (base: string): string[] => {
                    const candidates: string[] = []
                    const push = (candidate?: string) => {
                        if (!candidate) return
                        if (candidates.includes(candidate)) return
                        candidates.push(candidate)
                    }

                    push(base)

                    const slug = stepSlug || base.split(".")[0]
                    const withoutSlug =
                        slug && base.startsWith(`${slug}.`) ? base.slice(slug.length + 1) : base

                    if (slug) {
                        push(`${slug}.${withoutSlug}`)
                    }

                    appendOutputCandidates(push, withoutSlug, slug)
                    appendMetricCandidates(push, withoutSlug, slug)
                    appendOutputCandidates(push, base, slug)
                    appendMetricCandidates(push, base, slug)

                    return candidates
                }

                const needsPrefix = Boolean(stepSlug && !metricKey.startsWith(`${stepSlug}.`))
                const key = needsPrefix ? `${stepSlug}.${metricKey}` : metricKey
                const candidateKeys = Array.from(
                    new Set([...buildCandidateKeys(metricKey), ...buildCandidateKeys(key)]),
                )

                for (const candidate of candidateKeys) {
                    const resolved = getMetricValueWithAliases(metrics, candidate)
                    if (resolved !== undefined) {
                        return resolved
                    }
                }
                return undefined
            },
            deepEqual,
        ),
)

// Helper function to trigger metric fetch for a specific runId
export const triggerMetricsFetch = (targetRunId: string) => {
    const store = evalAtomStore()
    store.set(runMetricsRefreshFamily(targetRunId), (prev) => prev + 1)
}

/**
 * Run-scoped metrics prefetch attachment
 * This replaces the legacy attachRunMetricsPrefetch for multi-run support
 */
export function attachRunMetricsPrefetchForRun(
    runId: string,
    store: ReturnType<typeof import("jotai").createStore>,
) {
    const fetched = new Set<string>()

    // Subscribe to changes in evaluation run state for this specific run
    const unsubscribe = store.sub(evaluationRunStateFamily(runId), () => {
        const state = store.get(evaluationRunStateFamily(runId))
        const currentRunId = runId

        if (!currentRunId) {
            return
        }

        if (!state?.enrichedRun?.evaluators) {
            return // wait until evaluators are loaded
        }

        // Check if metrics are already cached using the actual currentRunId
        const cached = store.get(runMetricsCacheFamily(currentRunId))
        if (cached && cached.length > 0) {
            if (!fetched.has(currentRunId)) {
                fetched.add(currentRunId) // Mark as fetched since cache exists
            }
            return
        }

        // Check if we're already in the process of fetching
        if (fetched.has(currentRunId)) {
            return
        }

        fetched.add(currentRunId)

        // Trigger metrics fetch for the actual currentRunId
        triggerMetricsFetch(currentRunId)
    })

    return unsubscribe
}

/**
 * Run-scoped metric data family
 * This replaces the legacy metricDataFamily for multi-run support
 * Returns { value, distInfo } for a specific metric key on a scenario within a run
 */
export const runScopedMetricDataFamily = atomFamily(
    ({
        runId,
        scenarioId,
        stepSlug,
        metricKey,
    }: {
        runId: string
        scenarioId: string
        stepSlug?: string
        metricKey: string
    }) =>
        eagerAtom<{value: any; distInfo?: any}>((get) => {
            // Get the scenario metrics map for this run
            const scenarioMetricsMap = get(scenarioMetricsMapFamily(runId))
            // Get the metrics for this specific scenario
            const scenarioMetrics = scenarioMetricsMap[scenarioId]

            if (!scenarioMetrics) {
                return {value: undefined, distInfo: undefined}
            }

            const metricPath = stepSlug ? `${stepSlug}.${metricKey}` : metricKey

            const buildCandidateKeys = (base: string): string[] => {
                const candidates: string[] = []
                const push = (candidate?: string) => {
                    if (!candidate) return
                    if (candidates.includes(candidate)) return
                    candidates.push(candidate)
                }

                push(base)

                const slug = stepSlug || base.split(".")[0]
                const withoutSlug =
                    slug && base.startsWith(`${slug}.`) ? base.slice(slug.length + 1) : base

                if (slug) {
                    push(`${slug}.${withoutSlug}`)
                    push(`${slug}.attributes.ag.data.outputs.${withoutSlug}`)
                    push(`${slug}.attributes.ag.metrics.${withoutSlug}`)
                }

                push(`attributes.ag.data.outputs.${withoutSlug}`)
                push(`attributes.ag.metrics.${withoutSlug}`)

                return candidates
            }

            const candidateKeys = Array.from(
                new Set([...buildCandidateKeys(metricKey), ...buildCandidateKeys(metricPath)]),
            )

            const resolveFromSource = (source?: Record<string, any>) => {
                if (!source) return undefined
                for (const candidate of candidateKeys) {
                    const resolved = getMetricValueWithAliases(source, candidate)
                    if (resolved !== undefined) return resolved
                }
                return undefined
            }

            const value = resolveFromSource(scenarioMetrics)

            // Get distribution info from stats cache (if available)
            const statsCache = get(runMetricsStatsCacheFamily(runId))
            const distInfo = resolveFromSource(statsCache)

            return {value, distInfo}
        }),
)

// Cache for computed stats maps (adds binSize lazily) to preserve identity per raw object
const computedStatsCache = new WeakMap<Record<string, BasicStats>, Record<string, BasicStats>>()

// Atom family to read the entire stats map for a run, lazily adding binSize per entry.
// IMPORTANT: It also subscribes to runMetricsFamily(runId) to ensure that refresh triggers
// fetching even when only stats are being read by the UI.
export const runMetricStatsFamily = atomFamily(
    ({runId}: {runId: string}) =>
        eagerAtom<Record<string, BasicStats>>((get) => {
            // Wire up to metrics array to drive fetching on refresh
            // This ensures that setting runMetricsRefreshFamily(runId) will cause
            // runMetricsFamily(runId) to evaluate and kick off the background fetch.
            // We ignore its value here and continue to return the stats map.
            get(runMetricsFamily(runId))

            const obj = get(runMetricsStatsCacheFamily(runId)) as Record<string, BasicStats>
            if (!obj) return obj

            const cached = computedStatsCache.get(obj)
            if (cached) return cached

            let mutated = false
            const result: Record<string, BasicStats> = {}
            for (const [key, s] of Object.entries(obj)) {
                if (
                    s &&
                    (s as any).binSize === undefined &&
                    (s as any).distribution &&
                    (s as any).distribution.length
                ) {
                    const bins = (s as any).distribution.length
                    const range = ((s as any).max ?? 0) - ((s as any).min ?? 0)
                    result[key] = {
                        ...(s as any),
                        binSize: bins ? (range !== 0 ? range / bins : 1) : 1,
                    } as BasicStats
                    mutated = true
                } else {
                    result[key] = s as BasicStats
                }
            }

            const finalMap = mutated ? result : obj
            // memoize for this raw object identity
            computedStatsCache.set(obj, finalMap)
            return finalMap
        }),
    deepEqual,
)
