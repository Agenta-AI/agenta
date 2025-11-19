import axios from "@/oss/lib/api/assets/axiosConfig"
import {BasicStats, canonicalizeMetricKey} from "@/oss/lib/metricUtils"

import type {RunLevelStatsMap} from "./types"

export const metricKeyAliases: Record<string, string> = {
    "costs.total": "totalCost",
    "tokens.total": "totalTokens",
    "tokens.prompt": "promptTokens",
    "tokens.completion": "completionTokens",
}

export const deleteMetricsByIds = async ({
    projectId,
    metricIds,
}: {
    projectId: string
    metricIds: string[]
}) => {
    const uniqueMetricIds = Array.from(new Set(metricIds.filter(Boolean)))
    if (!uniqueMetricIds.length) return false

    try {
        await axios.delete(`/preview/evaluations/metrics/`, {
            params: {project_id: projectId},
            data: {metrics_ids: uniqueMetricIds},
        })
        console.info("[EvalRunDetails2] Deleted stale metrics after refresh", {
            projectId,
            metricIds: uniqueMetricIds,
        })
        return true
    } catch (error) {
        console.warn("[EvalRunDetails2] Failed to delete stale metrics", {
            projectId,
            metricIds: uniqueMetricIds,
            error,
        })
        return false
    }
}

const MAX_CATEGORICAL_ENTRIES = 20
const STAT_KEYS_TO_DROP = [
    "pcts",
    "pct",
    "iqrs",
    "pscs",
    "hist",
    "quartiles",
    "percentiles",
    "bins",
]

export const normalizeStatValue = (value: any): any => {
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
        next.rank = sorted.slice(0, MAX_CATEGORICAL_ENTRIES)
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = sorted.map((entry) => entry.value)
        }
        if (next.frequency.length > MAX_CATEGORICAL_ENTRIES) {
            next.frequency = next.frequency.slice(0, MAX_CATEGORICAL_ENTRIES)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        if (next.rank.length > MAX_CATEGORICAL_ENTRIES) {
            next.rank = next.rank.slice(0, MAX_CATEGORICAL_ENTRIES)
        }
    }

    if (Array.isArray(next.hist)) {
        if (!Array.isArray(next.distribution) || next.distribution.length === 0) {
            next.distribution = next.hist.map((entry: any) => {
                const interval = Array.isArray(entry?.interval) ? entry.interval : []
                const start =
                    interval.length > 0 && typeof interval[0] === "number"
                        ? interval[0]
                        : typeof entry?.value === "number"
                          ? entry.value
                          : typeof entry?.bin === "number"
                            ? entry.bin
                            : 0
                return {
                    value: start,
                    count: entry?.count ?? 0,
                }
            })
            next.distribution.sort((a: any, b: any) => (a?.value ?? 0) - (b?.value ?? 0))
        }

        if (typeof next.binSize !== "number") {
            const firstInterval = Array.isArray(next.hist[0]?.interval)
                ? next.hist[0]?.interval
                : undefined
            if (firstInterval && firstInterval.length >= 2) {
                const width = Number(firstInterval[1]) - Number(firstInterval[0])
                if (Number.isFinite(width) && width > 0) {
                    next.binSize = width
                }
            }
        }

        if (typeof next.min !== "number") {
            const firstInterval = Array.isArray(next.hist[0]?.interval)
                ? next.hist[0]?.interval
                : undefined
            const start = firstInterval && firstInterval.length > 0 ? firstInterval[0] : undefined
            if (typeof start === "number") {
                next.min = start
            }
        }

        if (typeof next.max !== "number") {
            const last = next.hist[next.hist.length - 1]
            const interval = Array.isArray(last?.interval) ? last.interval : undefined
            const end =
                interval && interval.length > 0
                    ? interval[interval.length - 1]
                    : typeof last?.edge === "number"
                      ? last.edge
                      : undefined
            if (typeof end === "number") {
                next.max = end
            }
        }

        delete next.hist
    }

    if (Array.isArray(next.unique) && next.unique.length > MAX_CATEGORICAL_ENTRIES) {
        next.unique = next.unique.slice(0, MAX_CATEGORICAL_ENTRIES)
    }

    STAT_KEYS_TO_DROP.forEach((key) => {
        if (key in next) {
            delete next[key]
        }
    })

    if (Array.isArray(next.distribution) && next.distribution.length > MAX_CATEGORICAL_ENTRIES) {
        next.distribution = next.distribution.slice(0, MAX_CATEGORICAL_ENTRIES)
    }

    return next
}

const toNumber = (value: any): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

const mergeFrequencyArrays = (a?: any[], b?: any[]): any[] | undefined => {
    if ((!a || !a.length) && (!b || !b.length)) return a || b
    const map = new Map<string, number>()
    const addEntries = (entries?: any[]) => {
        entries?.forEach((entry: any) => {
            const rawValue =
                entry?.value !== undefined
                    ? entry.value
                    : entry?.label !== undefined
                      ? entry.label
                      : entry?.name !== undefined
                        ? entry.name
                        : entry
            const key = JSON.stringify(rawValue)
            const count = toNumber(entry?.count ?? entry?.frequency ?? entry?.value ?? 0)
            if (count === undefined) return
            map.set(key, (map.get(key) ?? 0) + count)
        })
    }
    addEntries(a)
    addEntries(b)
    const merged = Array.from(map.entries()).map(([key, count]) => ({
        value: JSON.parse(key),
        count,
    }))
    merged.sort((x, y) => (y.count ?? 0) - (x.count ?? 0))
    return merged
}

const mergeUniqueValues = (a?: any[], b?: any[]): any[] | undefined => {
    if ((!a || !a.length) && (!b || !b.length)) return a || b
    const set = new Set<string>()
    const add = (values?: any[]) => values?.forEach((value) => set.add(JSON.stringify(value)))
    add(a)
    add(b)
    return Array.from(set.values()).map((value) => JSON.parse(value))
}

export const mergeBasicStats = (
    current: BasicStats | undefined,
    incoming: BasicStats,
): BasicStats => {
    if (!current) return {...incoming}
    const result: any = {...current}

    const incomingCount = toNumber(incoming.count)
    const existingCount = toNumber(result.count) ?? 0
    if (incomingCount !== undefined) {
        result.count = (existingCount ?? 0) + incomingCount
    }

    const incomingSum = toNumber(incoming.sum)
    if (incomingSum !== undefined) {
        result.sum = (toNumber(result.sum) ?? 0) + incomingSum
    }

    const incomingMin = toNumber(incoming.min)
    if (incomingMin !== undefined) {
        const currentMin = toNumber(result.min)
        result.min = currentMin === undefined ? incomingMin : Math.min(currentMin, incomingMin)
    }

    const incomingMax = toNumber(incoming.max)
    if (incomingMax !== undefined) {
        const currentMax = toNumber(result.max)
        result.max = currentMax === undefined ? incomingMax : Math.max(currentMax, incomingMax)
    }

    if (incoming.mean !== undefined && result.count && incomingSum !== undefined) {
        result.mean = (result.sum as number) / result.count
    }

    result.freq = mergeFrequencyArrays(result.freq, incoming.freq)
    result.unique = mergeUniqueValues(result.unique, incoming.unique)

    if (incoming.rank) {
        result.rank = mergeFrequencyArrays(result.rank, incoming.rank)
    }

    if (incoming.distribution) {
        result.distribution = mergeFrequencyArrays(result.distribution, incoming.distribution)
    }

    if (incoming.hist && !result.hist) {
        result.hist = incoming.hist
    }

    return result
}

export const ensureBinSize = (statsMap: RunLevelStatsMap): RunLevelStatsMap => {
    const next: RunLevelStatsMap = {}
    Object.entries(statsMap).forEach(([key, value]) => {
        if (!value || typeof value !== "object") {
            next[key] = value
            return
        }

        const stats: any = {...value}
        if (
            typeof stats.binSize !== "number" &&
            typeof stats.min === "number" &&
            typeof stats.max === "number"
        ) {
            const count = toNumber(stats.count) ?? 1
            const range = stats.max - stats.min
            if (Number.isFinite(range) && range > 0) {
                stats.binSize = range / count
            }
        }
        next[key] = stats
    })
    return next
}

const collectNestedStats = (
    value: any,
    prefix: string,
    bucket: Array<{key: string; stats: BasicStats}>,
    seen: Set<any>,
) => {
    if (!value || typeof value !== "object") return
    if (seen.has(value)) return
    seen.add(value)

    Object.entries(value).forEach(([key, nested]) => {
        if (!nested || typeof nested !== "object") {
            return
        }

        const path = prefix ? `${prefix}.${key}` : key
        if ("count" in nested || "mean" in nested || "sum" in nested) {
            bucket.push({key: path, stats: nested as BasicStats})
        } else {
            collectNestedStats(nested, path, bucket, seen)
        }
    })
}

export const flattenRunLevelMetricData = (
    data: Record<string, any>,
): Record<string, BasicStats> => {
    const flat: Record<string, BasicStats> = {}

    Object.entries(data || {}).forEach(([stepKey, metrics]) => {
        Object.entries(metrics as Record<string, any>).forEach(([metricKey, rawValue]) => {
            const normalizedValue = normalizeStatValue(rawValue) as BasicStats
            const originalKey = `${stepKey}.${metricKey}`
            const canonicalKey = canonicalizeMetricKey(originalKey)

            flat[originalKey] = mergeBasicStats(flat[originalKey], normalizedValue)
            if (canonicalKey !== originalKey) {
                flat[canonicalKey] = mergeBasicStats(flat[canonicalKey], normalizedValue)
            }

            const aliasKey = metricKeyAliases[metricKey]
            if (aliasKey) {
                const aliasComposite = `${stepKey}.${aliasKey}`
                flat[aliasComposite] = mergeBasicStats(flat[aliasComposite], normalizedValue)
                const canonicalAlias = canonicalizeMetricKey(aliasComposite)
                if (canonicalAlias !== aliasComposite) {
                    flat[canonicalAlias] = mergeBasicStats(flat[canonicalAlias], normalizedValue)
                }
            }

            const analyticsIndex = originalKey.indexOf("attributes.ag.")
            if (analyticsIndex >= 0) {
                const analyticsKey = originalKey.slice(analyticsIndex)
                flat[analyticsKey] = mergeBasicStats(flat[analyticsKey], normalizedValue)
                const canonicalAnalyticsKey = canonicalizeMetricKey(analyticsKey)
                if (canonicalAnalyticsKey !== analyticsKey) {
                    flat[canonicalAnalyticsKey] = mergeBasicStats(
                        flat[canonicalAnalyticsKey],
                        normalizedValue,
                    )
                }
            }

            const nestedStats: Array<{key: string; stats: BasicStats}> = []
            collectNestedStats(normalizedValue, "", nestedStats, new Set<any>())

            nestedStats.forEach(({key: nestedKey, stats}) => {
                const stepScopedNestedKey = `${stepKey}.${nestedKey}`
                flat[stepScopedNestedKey] = mergeBasicStats(flat[stepScopedNestedKey], stats)
                flat[nestedKey] = mergeBasicStats(flat[nestedKey], stats)

                const canonicalNestedKey = canonicalizeMetricKey(nestedKey)
                if (canonicalNestedKey !== nestedKey) {
                    flat[canonicalNestedKey] = mergeBasicStats(flat[canonicalNestedKey], stats)
                    const canonicalStepScoped = `${stepKey}.${canonicalNestedKey}`
                    flat[canonicalStepScoped] = mergeBasicStats(flat[canonicalStepScoped], stats)
                }
            })
        })
    })

    return flat
}

export const normalizeStatsMap = (stats: Record<string, any>): RunLevelStatsMap => {
    const normalized: RunLevelStatsMap = {}
    Object.entries(stats || {}).forEach(([key, value]) => {
        const normalizedValue = normalizeStatValue(value)
        normalized[key] = mergeBasicStats(normalized[key], normalizedValue as BasicStats)
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key) {
            normalized[canonical] = mergeBasicStats(
                normalized[canonical],
                normalizedValue as BasicStats,
            )
        }
    })

    return ensureBinSize(normalized)
}

export const includeTemporalFlag = (flag?: boolean) => flag === true
