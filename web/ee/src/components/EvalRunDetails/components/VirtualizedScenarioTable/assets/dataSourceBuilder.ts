import groupBy from "lodash/groupBy"

import type {
    RunIndex,
    ColumnDef,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {buildSkeletonRows} from "@/oss/lib/tableUtils"
import {EvaluationStatus} from "@/oss/lib/Types"

import {TableRow} from "../types"

import {GeneralMetricColumns} from "./constants"

/**
 * Build the data source (rows) for the virtualised scenario table.
 * This logic was previously inline inside the table component; moving it here means
 * the component can stay tidy while we have a single canonical place that knows:
 *   • which scenarios belong to the run
 *   • what their execution / annotation status is
 *   • how to present skeleton rows while data is still loading
 */

export function buildScenarioTableRows({
    scenarioIds,
    /** map scenarioId -> {status: EvaluationStatus; result?: any} */
    allScenariosLoaded,
    skeletonCount = 20,
}: {
    scenarioIds: string[]
    // statusMap: Record<string, {status: EvaluationStatus; result?: any} | undefined>
    allScenariosLoaded: boolean
    skeletonCount?: number
}): TableRow[] {
    if (!allScenariosLoaded) {
        // Render placeholder skeleton rows (fixed count) so the table height is stable
        return buildSkeletonRows(skeletonCount).map((r, idx) => ({
            ...r,
            scenarioIndex: idx + 1,
        }))
    }

    return scenarioIds.map((id, idx) => {
        return {
            key: id,
            scenarioIndex: idx + 1,
        }
    })
}

/**
 * Build raw ColumnDef list for scenario table.
 */
export function buildScenarioTableData({
    runIndex,
    metricsFromEvaluators,
}: {
    runIndex: RunIndex | null | undefined
    metricsFromEvaluators: Record<string, Record<string, any>>
}): (ColumnDef & {values?: Record<string, any>})[] {
    const baseColumnDefs: ColumnDef[] = runIndex ? Object.values(runIndex.columnsByStep).flat() : []

    // Augment columns with per-scenario values (currently only for input columns)
    let columnsInput = baseColumnDefs.filter((col) => col.kind !== "annotation")

    // Further group metrics by evaluator when evaluators info present
    const evaluatorMetricGroups: any[] = []

    // Evaluator Metric Columns
    if (metricsFromEvaluators) {
        const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")
        const groupedAnnotationData = groupBy(annotationData, (data) => {
            return data.name.split(".")[0]
        })

        for (const [k, v] of Object.entries(groupedAnnotationData)) {
            evaluatorMetricGroups.push({
                title: k,
                key: `metrics_${k}`,
                children: v.map((data) => {
                    const [evaluatorSlug, metricName] = data.name.split(".")
                    return {
                        ...data,
                        name: metricName,
                        kind: "metric",
                        path: data.name,
                        stepKey: "metric",
                        metricType: metricsFromEvaluators[evaluatorSlug].find(
                            (x) => metricName in x,
                        )[metricName]?.metricType,
                    }
                }),
            })
        }
    }

    const genericMetricsGroup = {
        title: "Metrics",
        key: "__metrics_group__",
        children: GeneralMetricColumns,
    }

    const metaStart: ColumnDef[] = [
        {name: "#", kind: "meta" as any, path: "scenarioIndex", stepKey: "meta"},
        {name: "Status", kind: "meta" as any, path: "status", stepKey: "meta"},
    ]
    const metaEnd: ColumnDef[] = [
        {name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"},
    ]

    const columnsCore = [...columnsInput, ...evaluatorMetricGroups]
    if (genericMetricsGroup) columnsCore.push(genericMetricsGroup as any)
    const columns = [...metaStart, ...columnsCore, ...metaEnd]

    return columns
}
