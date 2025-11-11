import {EnhancedColumnType} from "@/oss/components/EnhancedUIs/Table/types"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {evalAtomStore} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {getMetricConfig} from "@/oss/lib/metrics/utils"
import {buildMetricSorter} from "@/oss/lib/metricSorter"
import {extractPrimitive, isSortableMetricType} from "@/oss/lib/metricUtils"

import {
    runMetricsStatsCacheFamily,
    runScopedMetricDataFamily,
    scenarioMetricValueFamily,
} from "../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import type {TableRow} from "../types"

import ActionCell from "./ActionCell"
import {CellWrapper, InputCell, InvocationResultCell, SkeletonCell} from "./CellComponents"
import {COLUMN_WIDTHS} from "./constants"
import {titleCase} from "./flatDataSourceBuilder"
import CollapsedAnnotationValueCell from "./MetricCell/CollapsedAnnotationValueCell"
import CollapsedMetricValueCell, {
    AutoEvalCollapsedMetricValueCell,
} from "./MetricCell/CollapsedMetricValueCell"
import {AnnotationValueCell, MetricValueCell} from "./MetricCell/MetricCell"
import {BaseColumn, TableColumn} from "./types"

// Helper to compare metric/annotation primitives across scenarios
function scenarioMetricPrimitive(recordKey: string, column: any, runId: string) {
    const st = evalAtomStore()
    let raw: any = column.values?.[recordKey]
    if (raw === undefined) {
        const metricKey = column.path || column.key || column.name || ""
        const fallbackKey = column.fallbackPath
        if (column.kind === "metric") {
            const stepSlug =
                column.stepKey && column.stepKey.includes(".")
                    ? column.stepKey.split(".")[1]
                    : undefined
            raw = st.get(
                scenarioMetricValueFamily({
                    runId,
                    scenarioId: recordKey,
                    metricKey,
                    stepSlug,
                }) as any,
            )
            if ((raw === undefined || raw === null) && fallbackKey && fallbackKey !== metricKey) {
                raw = st.get(
                    scenarioMetricValueFamily({
                        runId,
                        scenarioId: recordKey,
                        metricKey: fallbackKey,
                        stepSlug,
                    }) as any,
                )
            }
        } else {
            const stepSlug =
                column.stepKey && column.stepKey.includes(".")
                    ? column.stepKey.split(".")[1]
                    : undefined
            raw = st.get(
                runScopedMetricDataFamily({
                    scenarioId: recordKey,
                    stepSlug,
                    metricKey,
                    runId,
                }) as any,
            )?.value
            if ((raw === undefined || raw === null) && fallbackKey && fallbackKey !== metricKey) {
                raw = st.get(
                    runScopedMetricDataFamily({
                        scenarioId: recordKey,
                        stepSlug,
                        metricKey: fallbackKey,
                        runId,
                    }) as any,
                )?.value
            }
        }
    }
    return extractPrimitive(raw)
}

function scenarioMetricSorter(column: any, runId: string) {
    return buildMetricSorter<TableRow>((row) =>
        scenarioMetricPrimitive(row.key as string, column, runId),
    )
}

/**
 * Transforms a list of scenario metrics into a map of scenarioId -> metrics, merging
 * nested metrics under `outputs` into the same level.
 *
 * @param {{scenarioMetrics: any[]}} props - The props object containing the metrics.
 * @returns {Record<string, Record<string, any>>} - A map of scenarioId -> metrics.
 */
export const getScenarioMetricsMap = ({scenarioMetrics}: {scenarioMetrics: any[]}) => {
    const map: Record<string, Record<string, any>> = {}
    const _metrics = scenarioMetrics || []

    _metrics.forEach((m: any) => {
        const sid = m.scenarioId
        if (!sid) return

        // Clone the data object to avoid accidental mutations
        const data: Record<string, any> =
            m && typeof m === "object" && m.data && typeof m.data === "object" ? {...m.data} : {}

        // If metrics are nested under `outputs`, merge them into the same level
        if (data.outputs && typeof data.outputs === "object") {
            Object.assign(data, data.outputs)
            delete data.outputs
        }

        if (!map[sid]) map[sid] = {}
        Object.assign(map[sid], data)
    })

    return map
}

// ---------------- Column adapter ------------------
const generateColumnTitle = (col: BaseColumn) => {
    if (col.kind === "metric") {
        if (typeof col.title === "string" && col.title.trim().length > 0) {
            return col.title
        }
        if (typeof col.path === "string") {
            return getMetricConfig(col.path).label
        }
    }
    if (col.kind === "invocation") return titleCase(col.name)
    if (col.kind === "annotation") return titleCase(col.name)
    return titleCase(col.title ?? col.name)
}
const generateColumnWidth = (col: BaseColumn) => {
    if (col.kind === "meta") return 80
    if (col.kind === "input") return COLUMN_WIDTHS.input
    if (col.kind === "metric") return COLUMN_WIDTHS.metric
    if (col.kind === "annotation") return COLUMN_WIDTHS.metric
    if (col.kind === "invocation") return COLUMN_WIDTHS.response
    return 20
}
const orderRank = (def: EnhancedColumnType<TableRow>): number => {
    if (def.key === "#") return 0
    if (def.key === "inputs_group") return 1
    if (def.key === "outputs") return 2
    if (def.key === "Status") return 3
    if (def.key === "annotation" || def.key?.includes("metrics")) return 4
    if (def.key?.includes("evaluators")) return 5
    if (def.key === "__metrics_group__") return 6
    return 7
}

export function buildAntdColumns(
    cols: TableColumn[],
    runId: string,
    expendedRows: Record<string, boolean>,
): EnhancedColumnType<TableRow>[] {
    const resolveStepKeyForRun = (column: TableColumn, targetRunId: string) => {
        return column.stepKeyByRunId?.[targetRunId] ?? column.stepKey
    }
    const distMap = runId ? evalAtomStore().get(runMetricsStatsCacheFamily(runId)) : {}
    const evalType = evalAtomStore().get(evalTypeAtom)

    // Count how many input columns we have
    const inputColumns = cols.filter((col) => col.kind === "input")

    return cols
        .map((c: TableColumn): EnhancedColumnType<TableRow> | null => {
            const editLabel = generateColumnTitle(c)
            const common = {
                metricType: c.metricType ?? c.kind,
                title: editLabel,
                key: c.key ?? c.name,
                minWidth: generateColumnWidth(c),
                width: generateColumnWidth(c),
                __editLabel: editLabel,
            }
            const sortable =
                (c.kind === "metric" || c.kind === "annotation") &&
                isSortableMetricType(c.metricType)

            const sorter = sortable ? scenarioMetricSorter(c, runId) : undefined

            if (c.children) {
                // drop empty wrapper groups
                if ((!c.title && !c.name) || c.kind === "metrics_group") {
                    return {
                        ...common,
                        __editLabel: editLabel,
                        children: buildAntdColumns(c.children, runId, expendedRows),
                    } as EnhancedColumnType<TableRow>
                }
                if (c.key === "__metrics_group__" || c.key?.startsWith("metrics_")) {
                    return {
                        title: (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                                {c.key === "__metrics_group__" ? "Metrics" : (c.title ?? "")}
                            </span>
                        ),
                        dataIndex: c.key,
                        collapsible: true,
                        key: c.key,
                        __editLabel: editLabel,
                        renderAggregatedData: ({record}) => {
                            const hasAnnotation =
                                Array.isArray(c.children) &&
                                c.children.some((ch: any) => ch.kind === "annotation")
                            const evaluatorSlug =
                                c.key === "__metrics_group__"
                                    ? undefined
                                    : c.name ||
                                      c.key.replace(/^metrics_/, "").replace(/_evaluators/, "")
                            const scenarioId = (record as any).scenarioId || (record as any).key
                            if (hasAnnotation) {
                                return (
                                    <CollapsedAnnotationValueCell
                                        scenarioId={scenarioId}
                                        childrenDefs={c.children!}
                                    />
                                )
                            }
                            return evalType === "auto" ? (
                                <AutoEvalCollapsedMetricValueCell
                                    scenarioId={scenarioId}
                                    runId={(record as any).runId}
                                    evaluatorSlug={evaluatorSlug}
                                    childrenDefs={c.children}
                                />
                            ) : (
                                <CollapsedMetricValueCell
                                    scenarioId={scenarioId}
                                    runId={(record as any).runId}
                                    evaluatorSlug={evaluatorSlug}
                                    childrenDefs={c.children}
                                />
                            )
                        },
                        children: buildAntdColumns(c.children, runId, expendedRows),
                    }
                }

                return {
                    ...common,
                    __editLabel: editLabel,
                    title: titleCase(c.title ?? c.name),
                    key: c.key ?? c.name,
                    children: buildAntdColumns(c.children, runId, expendedRows),
                } as EnhancedColumnType<TableRow>
            }

            if (c.kind === "meta") {
                switch (c.path) {
                    case "scenarioIndex":
                        return {
                            ...common,
                            fixed: "left",
                            width: 50,
                            minWidth: 50,
                            onCell: (record) => {
                                const showBorder =
                                    expendedRows?.[record.key] ||
                                    (record?.isComparison && !record.isLastRow)
                                return {
                                    className: showBorder
                                        ? "!border-b-0 !p-0"
                                        : record?.children?.length || record?.isComparison
                                          ? "!p-0"
                                          : "",
                                }
                            },
                            render: (_: any, record: TableRow) => (
                                <CellWrapper>{record.scenarioIndex}</CellWrapper>
                            ),
                        }
                    case "action":
                        if (evalType === "auto") return null
                        return {
                            ...common,
                            fixed: "right",
                            width: 120,
                            minWidth: 120,
                            render: (_: any, record: TableRow) => {
                                // Use runId from record data instead of function parameter
                                const effectiveRunId = (record as any).runId || runId
                                return (
                                    <ActionCell
                                        scenarioId={record.scenarioId || record.key}
                                        runId={effectiveRunId}
                                    />
                                )
                            },
                        }
                    default:
                        return {...common, dataIndex: c.path}
                }
            }

            if (c.kind === "input") {
                const isFirstInput = inputColumns.length > 0 && inputColumns[0] === c
                if (!isFirstInput) return null

                return {
                    title: (
                        <span className="flex items-center gap-1 whitespace-nowrap">Inputs</span>
                    ),
                    dataIndex: "inputs_group",
                    key: "inputs_group",
                    align: "left",
                    collapsible: true,
                    addNotAvailableCell: false,
                    onCell: (record) => {
                        const showBorder =
                            expendedRows?.[record.key] ||
                            (record?.isComparison && !record.isLastRow)
                        return {
                            className: showBorder ? "!border-b-0 !bg-white" : "!bg-white",
                        }
                    },
                    renderAggregatedData: ({record, isCollapsed}) => {
                        if (record.isComparison) return null
                        return (
                            <div className="flex flex-col gap-2 group">
                                <Expandable expandKey={record.key} disableExpand={!isCollapsed}>
                                    {inputColumns.map((inputCol) => (
                                        <div key={inputCol.key} className="text-wrap">
                                            <span className="font-medium text-gray-500">
                                                {titleCase(inputCol.name!)}:
                                            </span>{" "}
                                            <InputCell
                                                scenarioId={record.key}
                                                stepKey={resolveStepKeyForRun(inputCol, runId)}
                                                inputKey={inputCol.path}
                                                showEditor={false}
                                                disableExpand={isCollapsed}
                                            />
                                        </div>
                                    ))}
                                </Expandable>
                            </div>
                        )
                    },
                    children: inputColumns.map((inputCol, idx) => ({
                        title: titleCase(inputCol.name!),
                        key: `${inputCol.name}-input-${idx}`,
                        addNotAvailableCell: false,
                        onCell: (record) => {
                            const showBorder =
                                expendedRows?.[record.key] ||
                                (record?.isComparison && !record.isLastRow)
                            return {
                                className: showBorder ? "!border-b-0 !bg-white" : "!bg-white",
                            }
                        },
                        render: (_: any, record: TableRow) => {
                            if (record.isComparison) return ""
                            return (
                                <InputCell
                                    scenarioId={record.key}
                                    stepKey={resolveStepKeyForRun(inputCol, runId)}
                                    inputKey={inputCol.path}
                                />
                            )
                        },
                    })),
                }
            }

            return {
                ...common,
                sorter,
                render: (_unused: any, record: TableRow) => {
                    // Use runId from record data instead of function parameter
                    const effectiveRunId = (record as any).runId || runId
                    // if (record.isSkeleton) return
                    switch (c.kind) {
                        case "input": {
                            const inputStepKey = resolveStepKeyForRun(c, effectiveRunId)
                            return (
                                <InputCell
                                    scenarioId={record.scenarioId || record.key}
                                    stepKey={inputStepKey}
                                    inputKey={c.path}
                                    runId={effectiveRunId}
                                />
                            )
                        }
                        case "invocation": {
                            const invocationStepKey = resolveStepKeyForRun(c, effectiveRunId)
                            return (
                                <InvocationResultCell
                                    isSkeleton={record.isSkeleton}
                                    scenarioId={record.scenarioId || record.key}
                                    stepKey={invocationStepKey}
                                    path={c.path}
                                    runId={effectiveRunId}
                                    record={record}
                                />
                            )
                        }
                        case "annotation": {
                            const annotationStepKey = resolveStepKeyForRun(c, effectiveRunId)
                            return (
                                <AnnotationValueCell
                                    scenarioId={record.scenarioId || record.key}
                                    fieldPath={c.path}
                                    metricKey={c.name}
                                    metricType={c.metricType}
                                    fullKey={c.path}
                                    distInfo={distMap[c.path]}
                                    stepKey={annotationStepKey}
                                    name={c.name}
                                    runId={effectiveRunId}
                                />
                            )
                        }
                        case "metric":
                            return (
                                <MetricValueCell
                                    scenarioId={record.scenarioId || record.key}
                                    metricKey={c.path}
                                    fallbackKey={c.fallbackPath}
                                    fullKey={c.path}
                                    distInfo={
                                        distMap[c.path] ??
                                        (c.fallbackPath ? distMap[c.fallbackPath] : undefined)
                                    }
                                    metricType={c.metricType}
                                    runId={effectiveRunId}
                                    evalType={evalType!}
                                />
                            )
                        default:
                            return record.isSkeleton ? (
                                <SkeletonCell />
                            ) : (
                                (c.values?.[record.scenarioId || record.key] ?? "")
                            )
                    }
                },
            }
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (!a || !b) return 0
            const r = orderRank(a) - orderRank(b)
            if (r !== 0) return r
            const aName = "title" in a && a.title ? String(a.title) : a.key
            const bName = "title" in b && b.title ? String(b.title) : b.key
            return aName?.localeCompare(bName)
        }) as EnhancedColumnType<TableRow>[]
}
