import useSWR from "swr"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {snakeToCamelCaseKeys} from "@/oss/lib/helpers/casing"
import {METRICS_ENDPOINT, computeRunMetrics} from "@/oss/services/runMetrics/api"
import {BasicStats} from "@/oss/services/runMetrics/api/types"

import type {Metric, MetricResponse} from "../useEvaluationRunMetrics/types"

// Returns aggregated advanced stats per run
const fetchRunMetricsMap = async (
    runIds: string[],
): Promise<Record<string, Record<string, BasicStats>>> => {
    const params = new URLSearchParams()
    runIds.forEach((id) => params.append("run_ids", id))
    const res = await axios.get(`${METRICS_ENDPOINT}?${params.toString()}`)
    const rawMetrics: MetricResponse[] = Array.isArray(res.data?.metrics) ? res.data.metrics : []

    // Helper to classify & flatten metric payload (mirrors fetchRunMetrics.worker)
    const transformData = (data: Record<string, any>): Record<string, any> => {
        const flat: Record<string, any> = {}
        Object.entries(data || {}).forEach(([stepKey, metrics]) => {
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
                    }
                }
                if (isInvocation) {
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
    rawMetrics.forEach((m) => {
        const metric = snakeToCamelCaseKeys(m) as Metric
        if (!metric.scenarioId || !metric.runId) return
        const key = metric.runId
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

const useRunMetricsMap = (runIds: string[] | undefined) => {
    const swrKey = runIds && runIds.length ? ["runMetricsMap", ...runIds] : null
    const {data, error, isLoading} = useSWR<Record<string, Record<string, BasicStats>>>(
        swrKey,
        () => fetchRunMetricsMap(runIds!),
    )
    return {data, isLoading, isError: !!error}
}

export default useRunMetricsMap
