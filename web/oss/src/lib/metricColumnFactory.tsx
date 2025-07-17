import React from "react"

import {ColumnsType} from "antd/es/table"

import {MetricDetailsPopoverWrapper} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
// import {EvaluationRow} from "@/oss/components/HumanEvaluations/assets/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {buildMetricSorter} from "@/oss/lib/metricSorter"
import {isSortableMetricType, BasicStats} from "@/oss/lib/metricUtils"

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

        return {
            key: `${evaluator.slug}:${metricKey}`,
            title: (
                <div className="flex flex-col gap-1 whitespace-nowrap">
                    <span>{metricKey}</span>
                </div>
            ),
            sorter: sortable
                ? buildMetricSorter<EvaluationRow>((row) => {
                      const runId = "id" in row ? row.id : (row as any).key
                      return runMetricsMap?.[runId]?.[`${evaluator.slug}.${metricKey}`]
                  })
                : undefined,
            render: (_: any, record: EvaluationRow) => {
                const hasEvaluator = Array.isArray((record as any).evaluators)
                    ? (record as any).evaluators.some(
                          (e: EvaluatorDto) => e.slug === evaluator.slug,
                      )
                    : false

                const stats =
                    runMetricsMap?.[("id" in record ? record.id : (record as any).key) as string]?.[
                        `${evaluator.slug}.${metricKey}`
                    ]

                return hasEvaluator ? (
                    <MetricDetailsPopoverWrapper
                        runId={"id" in record ? record.id : (record as any).key}
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
