import type {BasicStats} from "@/oss/lib/metricUtils"

export const isBooleanMetricStats = (stats: BasicStats | undefined): boolean => {
    if (!stats) return false
    const uniqueValues = Array.isArray(stats.unique) ? stats.unique : []
    if (uniqueValues.length) {
        return uniqueValues.some(
            (value) =>
                typeof value === "boolean" ||
                value === 0 ||
                value === 1 ||
                value === "0" ||
                value === "1",
        )
    }

    const frequencyValues = Array.isArray((stats as any)?.frequency)
        ? (stats as any).frequency
        : Array.isArray((stats as any)?.freq)
          ? (stats as any).freq
          : Array.isArray((stats as any)?.rank)
            ? (stats as any).rank
            : []

    return frequencyValues.some((entry: any) => {
        const raw = entry?.value
        return typeof raw === "boolean" || raw === 0 || raw === 1 || raw === "0" || raw === "1"
    })
}

export interface BooleanHistogramDatum {
    label: "true" | "false"
    count: number
}

export interface BooleanHistogramResult {
    data: BooleanHistogramDatum[]
    domain: [number, number]
    total: number
    percentages: {true: number; false: number}
}

const DEFAULT_BOOLEAN_HISTOGRAM: BooleanHistogramResult = {
    data: [],
    domain: [0, 0],
    total: 0,
    percentages: {true: 0, false: 0},
}

export const buildBooleanHistogram = (
    stats: BasicStats | undefined,
    scenarioCount?: number,
): BooleanHistogramResult => {
    if (!isBooleanMetricStats(stats)) {
        return DEFAULT_BOOLEAN_HISTOGRAM
    }

    const rawStats = stats as unknown as {
        frequency?: {value: unknown; count?: number; frequency?: number}[]
        freq?: {value: unknown; count?: number; frequency?: number}[]
        rank?: {value: unknown; count?: number; frequency?: number}[]
        count?: number
    }

    const source = Array.isArray(rawStats.frequency)
        ? rawStats.frequency
        : Array.isArray(rawStats.freq)
          ? rawStats.freq
          : Array.isArray(rawStats.rank)
            ? rawStats.rank
            : []

    if (!source.length) {
        return DEFAULT_BOOLEAN_HISTOGRAM
    }

    const totals = {true: 0, false: 0}
    source.forEach((entry) => {
        const rawValue = entry?.value
        const valueKey =
            typeof rawValue === "boolean" ? String(rawValue) : String(rawValue).trim().toLowerCase()
        const countValue = Number(entry?.count ?? entry?.frequency ?? 0)
        if (!Number.isFinite(countValue)) return
        if (valueKey === "true" || valueKey === "1") {
            totals.true += countValue
        } else if (valueKey === "false" || valueKey === "0") {
            totals.false += countValue
        }
    })

    let totalCount = totals.true + totals.false

    const effectiveScenarioCount = (() => {
        if (typeof scenarioCount === "number" && scenarioCount > 0) return scenarioCount
        if (typeof rawStats.count === "number" && rawStats.count > 0) return rawStats.count
        if (typeof stats?.count === "number" && stats.count > 0) return stats.count
        return 0
    })()

    if (effectiveScenarioCount > 1 && totalCount > 0 && totalCount <= 1 + Number.EPSILON) {
        totals.true *= effectiveScenarioCount
        totals.false *= effectiveScenarioCount
        totals.true = Math.round(totals.true)
        totals.false = Math.max(0, Math.round(effectiveScenarioCount - totals.true))
        totalCount = totals.true + totals.false
    }

    if (totalCount <= 0) {
        return DEFAULT_BOOLEAN_HISTOGRAM
    }

    const maxDomain = Math.max(totalCount, totals.true, totals.false)

    const truePercentage = (totals.true / totalCount) * 100
    const falsePercentage = (totals.false / totalCount) * 100

    return {
        data: [
            {label: "true", count: totals.true},
            {label: "false", count: totals.false},
        ],
        domain: [0, maxDomain],
        total: totalCount,
        percentages: {
            true: truePercentage,
            false: falsePercentage,
        },
    }
}
