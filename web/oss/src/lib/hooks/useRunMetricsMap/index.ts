import useSWR from "swr"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {METRICS_ENDPOINT, computeRunMetrics} from "@/oss/services/runMetrics/api"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import type {MetricResponse} from "../useEvaluationRunMetrics/types"

// Returns aggregated advanced stats per run
const fetchRunMetricsMap = async (
    runIds: string[],
    evaluatorSlugs: Set<string> | undefined,
): Promise<Record<string, Record<string, BasicStats>>> => {
    // POST to query endpoint with body { metrics: { run_ids: [...] }, windowing: {...} }
    const endpoint = `${METRICS_ENDPOINT}query`
    const body: Record<string, any> = {
        metrics: {
            ...(Array.isArray(runIds) && runIds.length ? {run_ids: runIds} : {}),
            scenario_null: true,
        },
        windowing: {},
    }
    const res = await axios.post(endpoint, body)

    const rawMetrics: MetricResponse[] = Array.isArray(res.data?.metrics) ? res.data.metrics : []

    // Process evaluator metrics to ensure they have the correct prefix important for auto eval
    const processedMetrics = rawMetrics.map((metric) => {
        if (!metric.data) return metric

        const processedData: Record<string, any> = {}

        // add evaluator metrics to processed data
        Object.entries(metric.data as Record<string, Record<string, any>>).forEach(
            ([stepKey, stepData]) => {
                const parts = stepKey.split(".")
                if (parts.length === 1) {
                    const slug = parts[0]
                    try {
                        if (evaluatorSlugs?.has(slug)) {
                            // This is an evaluator metric, ensure all keys are prefixed
                            const newStepData: Record<string, any> = {}
                            Object.entries(stepData).forEach(([key, value]) => {
                                const prefixedKey = key.startsWith(`${slug}.`)
                                    ? key
                                    : `${slug}.${key}`
                                newStepData[prefixedKey] = value
                            })
                            processedData[stepKey] = newStepData
                        } else {
                            // Keep non-evaluator data as is
                            processedData[stepKey] = stepData
                        }
                    } catch (e) {
                        if (evaluatorSlugs?.includes(slug)) {
                            // This is an evaluator metric, ensure all keys are prefixed
                            const newStepData: Record<string, any> = {}
                            Object.entries(stepData).forEach(([key, value]) => {
                                const prefixedKey = key.startsWith(`${slug}.`)
                                    ? key
                                    : `${slug}.${key}`
                                newStepData[prefixedKey] = value
                            })
                            processedData[stepKey] = newStepData
                        } else {
                            // Keep non-evaluator data as is
                            processedData[stepKey] = stepData
                        }
                    }
                } else {
                    // Keep invocation data as is
                    processedData[stepKey] = stepData
                }
            },
        )

        return {
            ...metric,
            data: processedData,
        }
    })

    // Helper to classify & flatten metric payload (mirrors fetchRunMetrics.worker)
    const transformData = (data: Record<string, any>): Record<string, any> => {
        const flat: Record<string, any> = {}
        Object.entries(data || {}).forEach(([stepKey, metrics]) => {
            // Pass-through for analytics keys like ag.metrics.*
            if (stepKey.startsWith("ag.")) {
                const raw = metrics
                let value: any = raw
                if (typeof raw === "object" && raw !== null) {
                    if ("mean" in raw) value = (raw as any).mean
                    else if ("value" in raw) value = (raw as any).value
                }
                flat[stepKey] = value
                return
            }

            const isAnalyticsPath = stepKey.startsWith("attributes.ag.")

            const parts = stepKey.split(".")
            const isInvocation = parts.length === 1
            const slug = isInvocation ? undefined : parts[1]
            Object.entries(metrics as Record<string, any>).forEach(([metricKey, raw]) => {
                let value: any = raw
                if (typeof raw === "object" && raw !== null) {
                    if ("mean" in raw) {
                        value = (raw as any).mean
                    } else if ("value" in raw) {
                        value = (raw as any).value
                    } else if ("freq" in raw || "uniq" in raw) {
                        const mapped: any = {...raw}
                        if (Array.isArray(mapped.freq)) {
                            mapped.frequency = mapped.freq.map((entry: any) => ({
                                value: entry?.value,
                                count: entry?.count ?? entry?.frequency ?? 0,
                            }))
                            mapped.frequency.sort(
                                (a: any, b: any) =>
                                    b.count - a.count || (a.value === true ? -1 : 1),
                            )
                            delete mapped.freq
                            mapped.rank = mapped.frequency
                        }
                        if (Array.isArray(mapped.uniq)) {
                            mapped.unique = mapped.uniq
                            delete mapped.uniq
                        }
                        if (!Array.isArray(mapped.unique) && Array.isArray(mapped.frequency)) {
                            mapped.unique = mapped.frequency.map((entry: any) => entry.value)
                        }
                        value = mapped
                    }
                }
                if (isAnalyticsPath) {
                    const canonicalKey = `${stepKey}.${metricKey}`
                    flat[canonicalKey] = value
                    // Legacy fallback for evaluator display (last segment only)
                    const legacyKey = metricKey
                    if (!(legacyKey in flat)) {
                        flat[legacyKey] = value
                    }
                } else if (isInvocation) {
                    let newKey = metricKey
                    if (metricKey.startsWith("tokens.")) {
                        newKey = metricKey.slice(7) + "Tokens" // tokens.prompt -> promptTokens
                    } else if (metricKey.startsWith("cost")) {
                        newKey = "totalCost"
                    }
                    flat[newKey] = value
                } else {
                    const pref = slug ? `${slug}.` : ""
                    flat[`${pref}${metricKey}`] = value
                }
            })
        })
        return flat
    }

    const buckets: Record<string, {data: Record<string, any>}[]> = {}
    processedMetrics.forEach((m) => {
        const metric = m
        if (!metric.scenario_id || !metric.run_id) return
        const key = metric.run_id
        if (!buckets[key]) buckets[key] = []
        const flattened = transformData(metric.data as any)
        buckets[key].push({data: flattened})
    })

    const result: Record<string, Record<string, BasicStats>> = {}
    Object.entries(buckets).forEach(([runId, entries]) => {
        const agg = computeRunMetrics(entries)
        result[runId] = agg
    })

    return result
}

const useRunMetricsMap = (
    runIds: string[] | undefined,
    evaluatorSlugs: Set<string> | undefined,
) => {
    const swrKey = runIds && runIds.length ? ["runMetricsMap", ...runIds] : null
    const {data, error, isLoading} = useSWR<Record<string, Record<string, BasicStats>>>(
        swrKey,
        () => fetchRunMetricsMap(runIds!, evaluatorSlugs!),
    )
    return {data, isLoading, isError: !!error}
}

export default useRunMetricsMap
