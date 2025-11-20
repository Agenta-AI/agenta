/*
 * Shared metric-handling utilities for Agenta Cloud front-end.
 * ---------------------------------------------------------------------------
 * These helpers consolidate common logic that previously lived in multiple
 * table utilities (HumanEvaluations, VirtualizedScenarioTable, MetricCell …).
 * Any future change to the metric data shape (e.g. new statistical fields) can
 * now be implemented in a single place.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Simple histogram entry returned by backend */
export interface FrequencyEntry<T = unknown> {
    value: T
    count: number
}

/** Stats object returned by backend `GET /runs/:id/metrics` */
export interface BasicStats {
    mean?: number
    sum?: number
    /** Ordered frequency list (most common first) */
    frequency?: FrequencyEntry[]
    /** Total sample count */
    count?: number
    // backend may add extra fields – index signature keeps type-safety while
    // allowing unknown additions.
    [key: string]: unknown
}

/** Metric primitive or stats wrapper */
export type MetricValue = BasicStats | unknown

/** Union of recognised primitive metric types */
export type PrimitiveMetricType = "number" | "boolean" | "string" | "array" | "object" | "null"

/**
 * An explicit metric type coming from evaluator schema can be either a single
 * string or a JSON-Schema union array (e.g. ["string","null"]).
 */
export type SchemaMetricType = PrimitiveMetricType | PrimitiveMetricType[]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a single primitive value from a metric payload.
 *
 * The backend may return either:
 *   • a plain primitive (number | string | boolean | array)
 *   • a {@link BasicStats} object containing statistical fields.
 *
 * This helper applies the heuristics used in several places:
 *   1. mean
 *   2. sum
 *   3. first frequency value
 *   4. fallback to raw object
 */
export function extractPrimitive<T = unknown>(metric: MetricValue): T | undefined {
    if (metric === null || metric === undefined) return undefined as any

    // Plain primitives / arrays are returned verbatim.
    if (typeof metric !== "object" || Array.isArray(metric)) return metric as any

    const stats = metric as BasicStats
    if (stats.mean !== undefined) return stats.mean as any
    if (stats.sum !== undefined) return stats.sum as any
    if (stats.frequency?.length) return stats.frequency[0].value as any

    // As a last resort return the object itself (caller decides what to do).
    return metric as any
}

/**
 * Infer the metric primitive type when evaluator schema does not provide one.
 *
 * Mainly used by table renderers to decide formatting & sorter eligibility.
 */
export function inferMetricType(raw: unknown, schemaType?: SchemaMetricType): PrimitiveMetricType {
    if (schemaType) {
        // When evaluator schema provides a union array we choose the first non-null type.
        if (Array.isArray(schemaType)) {
            const withoutNull = schemaType.filter((t) => t !== "null")
            return (withoutNull[0] ?? "string") as PrimitiveMetricType
        }
        return schemaType as PrimitiveMetricType
    }

    if (raw === null) return "null"
    if (Array.isArray(raw)) return "array"
    const t = typeof raw
    if (t === "number" || t === "boolean" || t === "string") return t
    return "object"
}

/**
 * Determine if a column with the given metric type should expose sorting.
 *
 * Current UX policy: only numeric and boolean primitives are sortable.
 */
export function isSortableMetricType(metricType: SchemaMetricType | undefined): boolean {
    if (!metricType) return true // fallback

    const types = Array.isArray(metricType) ? metricType : [metricType]
    return !types.includes("string") && !types.includes("array")
}

/**
 * Generic comparator function used by AntD Table sorter.
 * Returns negative / zero / positive like `Array.prototype.sort` expects.
 */
export function summarizeMetric(
    stats: BasicStats | undefined,
    schemaType?: SchemaMetricType,
): string | number | undefined {
    if (!stats) return undefined

    // 1. mean for numeric metrics (latency etc.)
    if (typeof (stats as any).mean === "number") {
        return (stats as any).mean
    }

    // 2. boolean metrics – proportion of true (percentage)
    if (schemaType === "boolean" && Array.isArray((stats as any).frequency)) {
        const trueEntry = (stats as any).frequency.find((f: any) => f.value === true)
        const total = (stats as any).count ?? 0
        if (total) {
            return ((trueEntry?.count ?? 0) / total) * 100
        }
    }

    // 3. ranked categorical metrics – show top value and count
    if (Array.isArray((stats as any).rank) && (stats as any).rank.length) {
        const top = (stats as any).rank[0]
        return `${top.value} (${top.count})`
    }

    // 4. plain count fallback
    if (typeof (stats as any).count === "number") {
        return (stats as any).count
    }

    return undefined
}

export function metricCompare(a: unknown, b: unknown): number {
    // undefined / null handling – push to bottom
    if (a === undefined || a === null) return 1
    if (b === undefined || b === null) return -1

    const numA = Number(a as any)
    const numB = Number(b as any)
    const bothNumeric = !Number.isNaN(numA) && !Number.isNaN(numB)
    if (bothNumeric) return numA - numB

    return String(a).localeCompare(String(b))
}

/**
 * Compute maximum width among children columns. Used when a metrics group is
 * collapsed into one column.
 */
export function maxChildWidth(
    children: {key?: string; dataIndex?: string; width?: number}[],
    distMap: Record<string, {width?: number}>,
    fallback = 160,
): number {
    return Math.max(
        ...children.map(
            (ch) => distMap[ch.key ?? ch.dataIndex ?? ""]?.width ?? ch.width ?? fallback,
        ),
    )
}
