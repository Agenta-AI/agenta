import groupBy from "lodash/groupBy"

import type {
    ColumnDef,
    RunIndex,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {buildSkeletonRows} from "@/oss/lib/tableUtils"

import {TableRow} from "../types"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {
    evalAtomStore,
    evaluationEvaluatorsAtom,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {GeneralAutoEvalMetricColumns, GeneralHumanEvalMetricColumns} from "./constants"
import {BasicStats} from "@/oss/lib/metricUtils"

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
    metrics,
}: {
    runIndex: RunIndex | null | undefined
    metricsFromEvaluators: Record<string, Record<string, any>>
    metrics: Record<string, BasicStats>
}): (ColumnDef & {values?: Record<string, any>})[] {
    const baseColumnDefs: ColumnDef[] = runIndex ? Object.values(runIndex.columnsByStep).flat() : []
    const evalType = evalAtomStore().get(evalTypeAtom)
    const evaluators = evalAtomStore().get(evaluationEvaluatorsAtom)

    // Augment columns with per-scenario values (currently only for input columns)
    let columnsInput = baseColumnDefs
        .filter((col) => col.kind !== "annotation")
        .filter((col) => col.name !== "testcase_dedup_id")

    // Further group metrics by evaluator when evaluators info present
    const evaluatorMetricGroups: any[] = []

    // Evaluator Metric Columns
    if (metricsFromEvaluators && evalType === "human") {
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
                        metricType: metricsFromEvaluators[evaluatorSlug]?.find(
                            (x) => metricName in x,
                        )?.[metricName]?.metricType,
                    }
                }),
            })
        }
    }

    if (metricsFromEvaluators && evalType === "auto") {
        const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")
        const groupedAnnotationData = groupBy(annotationData, (data) => {
            return data.name.split(".")[0]
        })

        for (const metricKey of Object.keys(metricsFromEvaluators)) {
            const evaluator = evaluators?.find((e) => e.slug === metricKey)

            evaluatorMetricGroups.push({
                title: evaluator?.name || metricKey,
                key: `metrics_${metricKey}_evaluators`,
                children: Object.entries(groupedAnnotationData)
                    .flatMap(([k, v]) => {
                        return v.map((data) => {
                            if (data.stepKey === metricKey) {
                                const metric = metrics?.[`${metricKey}.${data.name}`]
                                const isMean = metric?.mean !== undefined
                                return {
                                    ...data,
                                    name: `${k} (${isMean ? "mean" : "count"})`,
                                    key: `${metricKey}.${data.name}`,
                                    title: `${k} (${isMean ? "mean" : "count"})`,
                                    kind: "metric",
                                    path: `${metricKey}.${data.name}`,
                                    stepKey: "metric",
                                    metricType: metricsFromEvaluators[metricKey]?.find(
                                        (x) => data.name in x,
                                    )?.[data.name]?.metricType,
                                }
                            }
                        })
                    })
                    .filter(Boolean),
            })
        }
    }

    const genericMetricsGroup = {
        title: "Metrics",
        key: "__metrics_group__",
        children:
            evalType === "auto" ? GeneralAutoEvalMetricColumns : GeneralHumanEvalMetricColumns,
    }

    let metaStart: ColumnDef[] = [
        {name: "#", kind: "meta" as any, path: "scenarioIndex", stepKey: "meta"},
        {name: "Status", kind: "meta" as any, path: "status", stepKey: "meta"},
        // ...(evalType === "auto"
        //     ? [{name: "Evaluations", kind: "meta" as any, path: "evaluations", stepKey: "meta"}]
        //     : []),
    ]

    const metaEnd: ColumnDef[] = [
        {name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"},
    ]

    const columnsCore = [...columnsInput, ...evaluatorMetricGroups]
    if (genericMetricsGroup) columnsCore.push(genericMetricsGroup as any)
    const columns = [...metaStart, ...columnsCore, ...metaEnd]

    return columns
}
