import groupBy from "lodash/groupBy"

import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {formatColumnTitle} from "@/oss/components/Filters/EditColumns/assets/helper"
import {
    evalAtomStore,
    evaluationEvaluatorsFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import type {
    ColumnDef,
    RunIndex,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {BasicStats, canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {buildSkeletonRows} from "@/oss/lib/tableUtils"

import {TableRow} from "../types"

import {GeneralAutoEvalMetricColumns, GeneralHumanEvalMetricColumns} from "./constants"

const AUTO_INVOCATION_METRIC_SUFFIXES = GeneralAutoEvalMetricColumns.map((col) => col.path)
const AUTO_INVOCATION_METRIC_CANONICAL_SET = new Set(
    AUTO_INVOCATION_METRIC_SUFFIXES.map((path) => canonicalizeMetricKey(path)),
)

const matchesGeneralInvocationMetric = (path?: string): boolean => {
    if (!path) return false
    if (AUTO_INVOCATION_METRIC_SUFFIXES.some((suffix) => path.endsWith(suffix))) {
        return true
    }
    const segments = path.split(".")
    for (let i = 0; i < segments.length; i += 1) {
        const candidate = segments.slice(i).join(".")
        if (AUTO_INVOCATION_METRIC_CANONICAL_SET.has(canonicalizeMetricKey(candidate))) {
            return true
        }
    }
    return AUTO_INVOCATION_METRIC_CANONICAL_SET.has(canonicalizeMetricKey(path))
}

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
    allScenariosLoaded,
    skeletonCount = 20,
    runId,
}: {
    scenarioIds: string[]
    allScenariosLoaded: boolean
    skeletonCount?: number
    runId: string
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
            runId,
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
    runId,
    evaluators,
}: {
    runIndex: RunIndex | null | undefined
    metricsFromEvaluators: Record<string, Record<string, any>>
    metrics: Record<string, BasicStats>
    runId: string
    evaluators: EvaluatorDto[]
}): (ColumnDef & {values?: Record<string, any>})[] {
    const baseColumnDefs: ColumnDef[] = runIndex ? Object.values(runIndex.columnsByStep).flat() : []
    const evalType = evalAtomStore().get(evalTypeAtom)

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
            const evaluator = evaluators?.find((e) => e.slug === k)
            evaluatorMetricGroups.push({
                title: evaluator?.name || k,
                key: `metrics_${k}`,
                children: v.map((data) => {
                    const [evaluatorSlug, metricName] = data.name.split(".")
                    const formattedMetricName = formatColumnTitle(
                        metricName || data.name.replace(`${evaluatorSlug}.`, ""),
                    )
                    return {
                        ...data,
                        name: metricName || data.name,
                        title: formattedMetricName,
                        kind: "annotation",
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

            // Build children from base run annotations when available, otherwise from metrics map
            let children = Object.entries(groupedAnnotationData)
                .flatMap(([k, v]) => {
                    return v.map((data) => {
                        // Prefer strict match on slug in data.path when present, else stepKey
                        const pathPrefix = `${metricKey}.`
                        const belongsToEvaluator =
                            (data.path && data.path.startsWith(pathPrefix)) ||
                            data.stepKey === metricKey
                        if (belongsToEvaluator) {
                            const metric = metrics?.[`${metricKey}.${data.name}`]
                            const isMean = metric?.mean !== undefined
                            const legacyPath = `${metricKey}.${data.name}`
                            const fullPath = data.path ? `${metricKey}.${data.path}` : legacyPath

                            if (
                                matchesGeneralInvocationMetric(fullPath) ||
                                matchesGeneralInvocationMetric(legacyPath)
                            ) {
                                return undefined
                            }

                            const formattedName = formatColumnTitle(data.name)
                            return {
                                ...data,
                                name: data.name,
                                key: `${metricKey}.${data.name}`,
                                title: `${formattedName} ${isMean ? "(mean)" : ""}`.trim(),
                                kind: "metric",
                                path: fullPath,
                                fallbackPath: legacyPath,
                                stepKey: "metric",
                                metricType: metricsFromEvaluators[metricKey]?.find(
                                    (x) => data.name in x,
                                )?.[data.name]?.metricType,
                            }
                        }
                        return undefined
                    })
                })
                .filter(Boolean) as any[]

            // If no base annotations matched (evaluator only exists in comparison runs),
            // fall back to constructing children from metricsFromEvaluators
            if (!children.length) {
                const metricDefs = metricsFromEvaluators[metricKey] || []
                const seen = new Set<string>()
                children = metricDefs
                    .map((def: any) => {
                        const metricName = Object.keys(def || {})[0]
                        if (!metricName || seen.has(metricName)) return undefined
                        seen.add(metricName)
                        const fullPath = `${metricKey}.${metricName}`
                        if (
                            matchesGeneralInvocationMetric(fullPath) ||
                            matchesGeneralInvocationMetric(metricName)
                        ) {
                            return undefined
                        }
                        const formattedName = formatColumnTitle(metricName)
                        return {
                            name: metricName,
                            key: `${metricKey}.${metricName}`,
                            title: formattedName,
                            kind: "metric" as const,
                            path: `${metricKey}.${metricName}`,
                            fallbackPath: `${metricKey}.${metricName}`,
                            stepKey: "metric",
                            metricType: def?.[metricName]?.metricType,
                        }
                    })
                    .filter(Boolean) as any[]
            }

            evaluatorMetricGroups.push({
                title: evaluator?.name || metricKey,
                key: `metrics_${metricKey}_evaluators`,
                children,
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
    ]

    const metaEnd: ColumnDef[] = [
        {name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"},
    ]

    const columnsCore = [...columnsInput, ...evaluatorMetricGroups]
    if (genericMetricsGroup) columnsCore.push(genericMetricsGroup as any)
    const columns = [...metaStart, ...columnsCore, ...metaEnd]

    return columns
}

/**
 * Build columns for comparison mode showing multiple runs side-by-side
 */
export function buildComparisonTableColumns({
    baseRunId,
    comparisonRunIds,
    baseRunIndex,
    comparisonRunIndexes,
    metricsFromEvaluators,
}: {
    baseRunId: string
    comparisonRunIds: string[]
    baseRunIndex: RunIndex | null | undefined
    comparisonRunIndexes: Record<string, RunIndex | null | undefined>
    metricsFromEvaluators: Record<string, Record<string, any>>
}): (ColumnDef & {values?: Record<string, any>})[] {
    if (!baseRunIndex) return []

    const allRunIds = [baseRunId, ...comparisonRunIds]
    const evalType = evalAtomStore().get(evalTypeAtom)

    // Start with meta columns
    const metaColumns: ColumnDef[] = [
        {name: "#", kind: "meta" as any, path: "scenarioIndex", stepKey: "meta"},
    ]

    // Get base column definitions (inputs, outputs, etc.)
    const baseColumnDefs: ColumnDef[] = Object.values(baseRunIndex.columnsByStep).flat()
    const inputOutputColumns = baseColumnDefs
        .filter((col) => col.kind !== "annotation" && col.kind !== "metric")
        .filter((col) => col.name !== "testcase_dedup_id")

    // For comparison mode, we want to show inputs once, then outputs/metrics for each run
    const inputColumns = inputOutputColumns.filter((col) => col.stepKey === "input")

    // Create run-specific output columns
    const runSpecificColumns: any[] = []

    allRunIds.forEach((runId, index) => {
        const isBase = index === 0
        const runLabel = isBase ? "Base" : `Run ${index}`
        const runShort = runId.slice(0, 8)

        // Output columns for this run
        const outputColumns = inputOutputColumns
            .filter((col) => col.stepKey === "output")
            .map((col) => ({
                ...col,
                name: `${col.name} (${runLabel})`,
                title: `${col.name} (${runShort})`,
                runId,
                isComparison: !isBase,
            }))

        // Metric columns for this run
        if (metricsFromEvaluators && evalType !== "auto") {
            const annotationData = baseColumnDefs.filter((def) => def.kind === "annotation")
            const groupedAnnotationData = groupBy(annotationData, (data) => {
                return data.name.split(".")[0]
            })

            for (const [evaluatorSlug, annotations] of Object.entries(groupedAnnotationData)) {
                const metricGroup = {
                    title: `${evaluatorSlug} (${runLabel})`,
                    key: `metrics_${evaluatorSlug}_${runId}`,
                    runId,
                    isComparison: !isBase,
                    children: annotations.map((data) => {
                        const [, metricName] = data.name.split(".")
                        return {
                            ...data,
                            name: metricName,
                            title: `${metricName} (${runShort})`,
                            kind: "metric",
                            path: data.name,
                            stepKey: "metric",
                            runId,
                            isComparison: !isBase,
                            metricType: metricsFromEvaluators[evaluatorSlug]?.find(
                                (x) => metricName in x,
                            )?.[metricName]?.metricType,
                        }
                    }),
                }
                runSpecificColumns.push(metricGroup)
            }
        }

        runSpecificColumns.push(...outputColumns)
    })

    const actionColumns: ColumnDef[] = [
        {name: "Action", kind: "meta" as any, path: "action", stepKey: "meta"},
    ]

    return [...metaColumns, ...inputColumns, ...runSpecificColumns, ...actionColumns]
}

/**
 * Build rows for comparison mode with data from multiple runs
 */
export function buildComparisonTableRows({
    scenarioIds,
    baseRunId,
    comparisonRunIds,
    allScenariosLoaded,
    skeletonCount = 20,
}: {
    scenarioIds: string[]
    baseRunId: string
    comparisonRunIds: string[]
    allScenariosLoaded: boolean
    skeletonCount?: number
}): TableRow[] {
    if (!allScenariosLoaded) {
        return buildSkeletonRows(skeletonCount).map((r, idx) => ({
            ...r,
            scenarioIndex: idx + 1,
        }))
    }

    return scenarioIds.map((scenarioId, idx) => {
        const row: TableRow = {
            key: scenarioId,
            scenarioIndex: idx + 1,
            scenarioId,
            baseRunId,
            comparisonRunIds,
        }

        // Add run-specific data placeholders
        // The actual data will be populated by the table cells using atoms
        const allRunIds = [baseRunId, ...comparisonRunIds]
        allRunIds.forEach((runId) => {
            row[`${runId}_data`] = {
                runId,
                scenarioId,
                // Cell components will use atoms to get actual data
            }
        })

        return row
    })
}
