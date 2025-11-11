import {iqrsLevels, PERCENTILE_STOPS} from "./assets/contants"
import {BasicStats} from "./types"

export const METRICS_ENDPOINT = "/preview/evaluations/metrics/"

const fetchJSON = async (url: string, options: RequestInit) => {
    const res = await fetch(url, options)
    if (!res.ok) throw new Error(res.statusText)
    return res.json()
}

// /**
//  * Create a new run-level metric entry.
//  *
//  * @param apiUrl  The URL of the API service to create the metric against.
//  * @param jwt     The JWT token to authenticate the request.
//  * @param runId   The UUID of the evaluation run to associate with the metric.
//  * @param data    A dictionary of string keys to numeric values representing the
//  *                metric data.
//  *
//  * @returns The newly created metric object (snake_case).
//  */
// export const createRunMetrics = async (
//     apiUrl: string,
//     jwt: string,
//     runId: string,
//     data: Record<string, any>,
//     projectId: string,
// ) => {
//     const payload = {metrics: [{run_id: runId, data}]}
//     return fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?project_id=${projectId}`, {
//         method: "POST",
//         headers: {
//             "Content-Type": "application/json",
//             Authorization: `Bearer ${jwt}`,
//         },
//         body: JSON.stringify(payload),
//     })
// }

/**
 * Creates a new run-level metric or updates an existing one.
 *
 * This function will first attempt to fetch the existing metric associated
 * with the given runId. If a metric is found, it will be updated with the
 * new data. If no existing metric is found, a new metric entry will be
 * created.
 *
 * @param apiUrl  The base URL of the API service.
 * @param jwt     The JWT token used for authenticating the request.
 * @param runId   The UUID of the evaluation run to associate with the metrics.
 * @param data    A dictionary of string keys to numeric values representing the
 *                metric data.
 *
 * @returns The newly created or updated metric object (snake_case).
 */
// export const upsertRunMetrics = async (
//     apiUrl: string,
//     jwt: string,
//     runId: string,
//     data: Record<string, any>,
//     projectId: string,
// ) => {
//     try {
//         const params = new URLSearchParams({
//             run_ids: runId,
//         })
//         const res = await fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?${params.toString()}`, {
//             headers: {Authorization: `Bearer ${jwt}`},
//         })
//         const existing = Array.isArray(res.metrics) ? res.metrics[0] : undefined
//         if (existing) {
//             const merged = {...(existing.data || {}), ...data}
//             return updateMetric(apiUrl, jwt, existing.id, {
//                 data: merged,
//                 status: existing.status || "finished",
//                 tags: existing.tags,
//                 meta: existing.meta,
//             })
//         }
//     } catch {
//         /* ignore lookup errors and fall back to creation */
//     }
//     return createRunMetrics(apiUrl, jwt, runId, data, projectId)
// }

/**
 * Create or update scenario-level metrics for a specific evaluation run.
 *
 * This function takes a list of scenario metric entries and attempts to
 * either create new metrics or update existing ones based on the provided
 * runId and scenarioId. If a metric already exists for a given scenario,
 * it is updated with the new data. If no existing metric is found, a new
 * metric entry is created.
 *
 * @param apiUrl  The base URL of the API service.
 * @param jwt     The JWT token used for authenticating the request.
 * @param runId   The UUID of the evaluation run to associate with the metrics.
 * @param entries An array of objects containing scenarioId and data to
 *                be stored as metrics.
 *
 * @returns A promise that resolves when all create or update operations
 *          have been completed.
 */
export const createScenarioMetrics = async (
    apiUrl: string,
    jwt: string,
    runId: string,
    entries: {scenarioId: string; data: Record<string, any>}[],
    projectId: string,
) => {
    const toCreate: {run_id: string; scenario_id: string; data: Record<string, any>}[] = []
    const toUpdate: {
        id: string
        data: Record<string, any>
        status?: string
        tags?: Record<string, unknown>
        meta?: Record<string, unknown>
    }[] = []

    for (const entry of entries) {
        try {
            const params = new URLSearchParams({
                project_id: projectId,
                run_ids: runId,
                scenario_ids: entry.scenarioId,
            })
            const res = await fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?${params.toString()}`, {
                headers: {Authorization: `Bearer ${jwt}`},
            })
            const existing = Array.isArray(res.metrics) ? res.metrics[0] : undefined
            if (existing) {
                const mergedData = {
                    ...(existing.data || {}),
                    ...entry.data,
                }
                toUpdate.push({
                    id: existing.id,
                    data: mergedData,
                    status: existing.status,
                    tags: existing.tags,
                    meta: existing.meta,
                })
                continue
            }
        } catch {
            // ignore fetch errors and fallback to creation
        }
        toCreate.push({run_id: runId, scenario_id: entry.scenarioId, data: entry.data})
    }

    const promises: Promise<any>[] = []
    if (toCreate.length) {
        promises.push(
            fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?project_id=${projectId}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({metrics: toCreate}),
            }),
        )
    }
    if (toUpdate.length) {
        promises.push(
            fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?project_id=${projectId}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${jwt}`,
                },
                body: JSON.stringify({metrics: toUpdate}),
            }),
        )
    }
    return Promise.all(promises)
}

/**
 * Update a single metric entry.
 *
 * @param apiUrl  The URL of the API service to create the metric against.
 * @param jwt     The JWT token to authenticate the request.
 * @param metricId  The UUID of the metric to update.
 * @param changes  A dictionary of changes to apply to the metric.
 *
 * @returns The updated metric object (snake_case).
 */
export const updateMetric = async (
    apiUrl: string,
    jwt: string,
    metricId: string,
    changes: {
        data?: Record<string, any>
        status?: string
        tags?: Record<string, any>
        meta?: Record<string, any>
    },
    projectId: string,
) => {
    const payload = {metric: {id: metricId, ...changes}}
    return fetchJSON(`${apiUrl}${METRICS_ENDPOINT}${metricId}?project_id=${projectId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(payload),
    })
}

/**
 * Update multiple metric entries.
 *
 * @param apiUrl  The URL of the API service to update the metrics against.
 * @param jwt     The JWT token to authenticate the request.
 * @param metrics An array of metric objects to update. Each object should contain
 *                at least an 'id' property and may contain additional properties
 *                to update ('data', 'status', 'tags', 'meta').
 *
 * @returns An array of the updated metric objects (snake_case).
 */
export const updateMetrics = async (
    apiUrl: string,
    jwt: string,
    metrics: {
        id: string
        data?: Record<string, any>
        status?: string
        tags?: Record<string, any>
        meta?: Record<string, any>
    }[],
    projectId: string,
) => {
    return fetchJSON(`${apiUrl}${METRICS_ENDPOINT}?project_id=${projectId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({metrics}),
    })
}

// --- Statistics helpers --------------------------------------------------

/**
 * Calculates the p-th percentile of a sorted array of numbers.
 *
 * @param sorted - An array of numbers sorted in ascending order.
 * @param p - The percentile to calculate (between 0 and 100).
 * @returns The calculated percentile value.
 *          If the array is empty, returns 0.
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = (p / 100) * (sorted.length - 1)
    const lower = Math.floor(idx)
    const upper = Math.ceil(idx)
    if (lower === upper) return sorted[lower]
    const weight = idx - lower
    return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

// Helper: round to 'p' decimal places (default 6) and coerce back to number
// Smart rounding: for numbers < 0.001 use significant–figure precision to
// avoid long binary tails; otherwise use fixed decimal rounding.
const round = (v: number, p = 6, sig = 6): number => {
    if (Number.isNaN(v)) return v
    const abs = Math.abs(v)
    if (abs !== 0 && abs < 1e-3) {
        return Number(v.toPrecision(sig))
    }
    return Number(v.toFixed(p))
}

/**
 * Builds a histogram distribution from an array of numbers.
 *
 * This function calculates a histogram by determining the optimal number of bins
 * based on the square root of the number of input values. It then computes the
 * bin size and assigns each number to a bin. The resulting histogram is returned
 * as an array of objects, each containing a bin start value and the count of
 * numbers in that bin.
 *
 * @param values - An array of numbers to create the distribution from.
 * @returns An array of objects where each object represents a bin with the
 *          'value' as the bin start and 'count' as the number of elements
 *          in that bin. If all values are the same, returns a single bin
 *          with the value and the count of elements.
 */
function buildDistribution(values: number[]): {value: number; count: number}[] {
    if (!values.length) return []

    const n = values.length
    const bins = Math.ceil(Math.sqrt(n))
    const min = Math.min(...values)
    const max = Math.max(...values)

    if (min === max) {
        return [{value: round(min, 6), count: n}]
    }

    const binSize = (max - min) / bins
    // precision = number of decimal places required to keep bin starts stable
    const precision = binSize ? Math.max(0, -Math.floor(Math.log10(binSize))) : 0

    const hist = new Map<number, number>()

    values.forEach((v) => {
        let binIndex = Math.floor((v - min) / binSize)
        if (binIndex === bins) binIndex -= 1 // edge case when v === max
        const binStart = Number((min + binIndex * binSize).toFixed(precision))
        hist.set(binStart, (hist.get(binStart) ?? 0) + 1)
    })

    return Array.from(hist.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([value, count]) => ({value, count}))
}

/**
 * Computes various statistical measures for a given array of numbers.
 *
 * @param values - An array of numbers for which statistics are to be computed.
 * @returns An object containing the following statistical measures:
 *   - count: The number of elements in the array.
 *   - sum: The total sum of the elements.
 *   - mean: The average value of the elements.
 *   - min: The minimum value in the array.
 *   - max: The maximum value in the array.
 *   - range: The difference between the maximum and minimum values.
 *   - distribution: A histogram representation of the values.
 *   - percentiles: An object containing percentile values for defined stops.
 *   - iqrs: An object containing inter-quartile ranges as per backend mapping.
 */
function computeStats(values: number[]): BasicStats {
    const count = values.length
    if (count === 0) {
        return {
            count: 0,
            sum: 0,
            mean: 0,
            min: 0,
            max: 0,
            range: 0,
            distribution: [],
            percentiles: {},
            iqrs: {},
        }
    }

    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((acc, v) => acc + v, 0)
    const mean = sum / count
    const min = sorted[0]
    const max = sorted[sorted.length - 1]
    const range = max - min

    // Percentiles with rounded output
    const percentiles: Record<string, number> = {}
    PERCENTILE_STOPS.forEach((p) => {
        percentiles[`p${p}`] = round(percentile(sorted, p), 4)
    })

    const iqrs: Record<string, number> = {}
    Object.entries(iqrsLevels).forEach(([label, [low, high]]) => {
        iqrs[label] = round(percentiles[high] - percentiles[low], 4)
    })

    const distribution = buildDistribution(values)
    const bins = distribution.length
    const binSize = bins ? (range !== 0 ? range / bins : 1) : undefined

    return {
        count,
        sum: round(sum, 6),
        mean: round(mean, 6),
        min: round(min, 6),
        max: round(max, 6),
        range: round(range, 6),
        distribution,
        percentiles,
        iqrs,
        binSize: binSize !== undefined ? round(binSize, 6) : undefined,
    }
}

// --- Additional helpers for non-numeric metrics -------------------------

// Count of values
function count(values: unknown[]): number {
    return values.length
}

// Build frequency list [{value,count}]
function buildFrequency(values: unknown[]): {value: any; count: number}[] {
    const freqMap = new Map<any, number>()
    values.forEach((v) => freqMap.set(v, (freqMap.get(v) ?? 0) + 1))
    return Array.from(freqMap.entries()).map(([value, count]) => ({value, count}))
}

function buildRank(values: unknown[], topK = 10): {value: any; count: number}[] {
    return buildFrequency(values)
        .sort((a, b) => b.count - a.count)
        .slice(0, topK)
}

function processBinary(values: (boolean | null)[]): BasicStats {
    const filtered = values.map((v) => (v === null || v === undefined ? null : v))
    return {
        count: count(filtered),
        frequency: buildFrequency(filtered),
        unique: Array.from(new Set(filtered)),
        rank: buildRank(filtered),
    }
}

function processClass(values: (string | number | boolean | null)[]): BasicStats {
    return {
        count: count(values),
        frequency: buildFrequency(values),
        unique: Array.from(new Set(values)),
        rank: buildRank(values),
    }
}

function processLabels(values: ((string | number | boolean | null)[] | null)[]): BasicStats {
    // Flatten labels list
    const flat: (string | number | boolean | null)[] = []
    values.forEach((arr) => {
        if (Array.isArray(arr)) flat.push(...arr)
        else flat.push(null)
    })
    // Additionally compute distribution of label counts per record
    // const labelCounts = values.map((arr) => (Array.isArray(arr) ? arr.length : 0))
    // const distStats = computeStats(labelCounts)
    // const labelValueDistribution = buildFrequency(flat).map((f) => ({
    //     value: f.value,
    //     count: f.count,
    // }))
    const returnData = {
        count: count(flat),
        frequency: buildFrequency(flat),
        unique: Array.from(new Set(flat)),
        rank: buildRank(flat),
    }
    return returnData
}

// ------------------------------------------------------------------------

/**
 * Computes a map of metrics to their computed statistics, given a list of
 * objects with `data` properties containing key-value pairs of metric names
 * to their respective values.
 *
 * It will group values by metric key, and compute the following statistics
 * for each key:
 *
 * - `count`: The number of values.
 * - `sum`: The sum of all values.
 * - `mean`: The mean of all values.
 * - `min`: The minimum value.
 * - `max`: The maximum value.
 * - `range`: The difference between the maximum and minimum values.
 * - `distribution`: An array of 11 values representing the distribution of
 *   values between the minimum and maximum.
 * - `percentiles`: An object with keys `pX` where `X` is a percentile (e.g.
 *   `p25`, `p50`, `p75`), and values that are the corresponding percentiles
 *   of the values.
 * - `iqrs`: An object with keys that are the names of interquartile ranges
 *   (e.g. `iqr25`, `iqr50`, `iqr75`), and values that are the corresponding
 *   interquartile ranges of the values.
 *
 * @param metrics An array of objects with `data` properties containing key-value pairs of metric names to their respective values.
 * @returns An object with metric names as keys, and their computed statistics as values.
 */
export const computeRunMetrics = (
    metrics: {data: Record<string, any>}[],
): Record<string, BasicStats> => {
    if (!metrics?.length) return {}

    // Group values per metric key preserving raw values
    const valueBuckets: Record<string, any[]> = {}
    metrics.forEach((m) => {
        Object.entries(m.data || {}).forEach(([k, v]) => {
            if (v !== undefined) {
                valueBuckets[k] = valueBuckets[k] || []
                valueBuckets[k].push(v)
            }
        })
    })

    const result: Record<string, BasicStats> = {}
    Object.entries(valueBuckets).forEach(([k, values]) => {
        const allNumbers = values.every((v) => typeof v === "number" && !isNaN(v))
        const allBooleans = values.every((v) => typeof v === "boolean" || v === null)
        const allArrays = values.every((v) => Array.isArray(v))
        if (allNumbers) {
            result[k] = computeStats(values as number[])
        } else if (allBooleans) {
            result[k] = processBinary(values as (boolean | null)[])
        } else if (allArrays) {
            result[k] = processLabels(values as any[][]) // treat as labels metric
        } else {
            // Default to class metric for strings / mixed primitives
            result[k] = processClass(values as any[])
        }
    })

    return result
}

export interface MetricDistribution {
    distribution: {value: number; count: number}[]
    mean: number
    min: number
    max: number
    binSize: number
}

export const computeMetricDistribution = (
    values: number[],
    stats?: BasicStats,
): MetricDistribution | undefined => {
    let computed = stats
    if (!computed) {
        if (!values.length) return undefined
        const tmpKey = "__metric"
        const agg = computeRunMetrics(values.map((v) => ({data: {[tmpKey]: v}})))
        computed = agg[tmpKey]
    }
    if (!computed?.distribution || !computed.distribution.length) {
        return computed
    }
    let binSize = computed.binSize
    if (binSize === undefined) {
        const bins = computed.distribution.length
        const range = computed.range ?? (computed.max ?? 0) - (computed.min ?? 0)
        binSize = bins ? (range !== 0 ? range / bins : 1) : 1
    }
    return {
        distribution: computed.distribution,
        mean: computed.mean ?? 0,
        min: computed.min ?? 0,
        max: computed.max ?? 0,
        binSize,
    }
}
