import React from "react"

import {ColumnsType} from "antd/es/table"

import {MetricDetailsPopoverWrapper} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildMetricSorter} from "@/oss/lib/metricSorter"
import {
    isSortableMetricType,
    BasicStats,
    canonicalizeMetricKey,
    getMetricValueWithAliases,
} from "@/oss/lib/metricUtils"

const resolveMetricStats = (
    metrics: Record<string, BasicStats> | undefined,
    candidates: (string | undefined)[],
    fallbackSuffix?: string,
): BasicStats | undefined => {
    if (!metrics) return undefined
    const allCandidates = [...candidates]
    if (fallbackSuffix) {
        candidates.forEach((key) => {
            if (!key || key.endsWith(fallbackSuffix)) return
            allCandidates.push(`${key}.${fallbackSuffix}`)
        })
    }

    for (const key of allCandidates) {
        if (!key) continue
        if (metrics[key]) return metrics[key]
        const canonical = canonicalizeMetricKey(key)
        if (canonical !== key && metrics[canonical]) return metrics[canonical]
        const alias = getMetricValueWithAliases<BasicStats>(metrics, key)
        if (alias) return alias
    }
    return undefined
}

import {EvaluationRow} from "../components/HumanEvaluations/types"

export interface BuildEvaluatorMetricColumnsParams {
    evaluator: EvaluatorDto
    runMetricsMap?: Record<string, Record<string, BasicStats>>
    hidePrimitiveTable?: boolean
    debug?: boolean
}

export function buildEvaluatorMetricColumns({
    evaluator,
    runMetricsMap,
    hidePrimitiveTable = false,
    debug = false,
}: BuildEvaluatorMetricColumnsParams): ColumnsType<EvaluationRow> {
    const metricKeys = Object.keys(evaluator.metrics || {})
    return metricKeys.map((metricKey) => {
        const schemaType = evaluator.metrics?.[metricKey]?.type
        const sortable = isSortableMetricType(schemaType)

        const analyticsCandidates = [
            `attributes.ag.data.outputs.${metricKey}`,
            `attributes.ag.metrics.${metricKey}`,
        ]
        const baseCandidates = [
            `${evaluator.slug}.${metricKey}`,
            metricKey,
            ...analyticsCandidates.map((path) => `${evaluator.slug}.${path}`),
            ...analyticsCandidates,
        ]

        return {
            key: `${evaluator.slug}:${metricKey}`,
            dataIndex: metricKey,
            title: (
                <div className="flex flex-col gap-1 whitespace-nowrap">
                    <span>{metricKey}</span>
                </div>
            ),
            sorter: sortable
                ? buildMetricSorter<EvaluationRow>((row) => {
                      const runId = "id" in row ? row.id : (row as any).key
                      const metrics = runMetricsMap?.[runId]
                      return resolveMetricStats(metrics, baseCandidates)
                  })
                : undefined,
            render: (_: any, record: EvaluationRow) => {
                const hasEvaluator = Array.isArray((record as any).evaluators)
                    ? (record as any).evaluators.some(
                          (e: EvaluatorDto) => e.slug === evaluator.slug,
                      )
                    : false

                const runId = ("id" in record ? record.id : (record as any).key) as string
                const runMetric = runMetricsMap?.[runId]
                const stats = resolveMetricStats(runMetric, baseCandidates)

                return hasEvaluator ? (
                    <MetricDetailsPopoverWrapper
                        runId={runId}
                        evaluatorSlug={evaluator.slug}
                        evaluatorMetricKey={metricKey}
                        evaluator={evaluator}
                        statsOverride={stats}
                        hidePrimitiveTable={hidePrimitiveTable}
                        debug={debug}
                    />
                ) : (
                    <div className="not-available-table-cell" />
                )
            },
        } as any
    }) as ColumnsType<EvaluationRow>
}
