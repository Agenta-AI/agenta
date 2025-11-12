import clsx from "clsx"

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
import {EVAL_BG_COLOR} from "../../../AutoEvalRun/assets/utils"
import type {TableRow} from "../types"

import ActionCell from "./ActionCell"
import type {EvaluatorFailureMap} from "./atoms/evaluatorFailures"
import {
    CellWrapper,
    InputCell,
    InputSummaryCell,
    InvocationResultCell,
    SkeletonCell,
} from "./CellComponents"
import {COLUMN_WIDTHS} from "./constants"
import {titleCase} from "./flatDataSourceBuilder"
import CollapsedAnnotationValueCell from "./MetricCell/CollapsedAnnotationValueCell"
import CollapsedMetricValueCell, {
    AutoEvalCollapsedMetricValueCell,
} from "./MetricCell/CollapsedMetricValueCell"
import {AnnotationValueCell, EvaluatorFailureCell, MetricValueCell} from "./MetricCell/MetricCell"
import TimestampCell from "./TimestampCell"
import {BaseColumn, TableColumn} from "./types"

// ---------------- Helpers to detect/normalize annotation-like metric paths ----------------
const OUT_PREFIX = "attributes.ag.data.outputs."
const IN_PREFIX = "attributes.ag.data.inputs."

/** A “metric” column that actually points inside the annotation payload. */
const isAnnotationLikeMetricPath = (p?: string) =>
    typeof p === "string" && (p.includes(OUT_PREFIX) || p.includes(IN_PREFIX))

/** Strip the run-scoped prefix to the field path used by AnnotationValueCell helpers. */
const toAnnotationFieldPath = (p: string) =>
    p.includes(OUT_PREFIX)
        ? p.slice(OUT_PREFIX.length)
        : p.includes(IN_PREFIX)
          ? p.slice(IN_PREFIX.length)
          : p
// ------------------------------------------------------------------------------------------

// Helper to compare metric/annotation primitives across scenarios (used for sorting metrics)
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
 */
export const getScenarioMetricsMap = ({scenarioMetrics}: {scenarioMetrics: any[]}) => {
    const map: Record<string, Record<string, any>> = {}
    const _metrics = scenarioMetrics || []

    _metrics.forEach((m: any) => {
        const sid = m.scenarioId
        if (!sid) return

        const data: Record<string, any> =
            m && typeof m === "object" && m.data && typeof m.data === "object" ? {...m.data} : {}

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
    if (def.key === "timestamp") return 1
    if (def.key === "inputs_group") return 2
    if (def.key === "outputs" || def.key === "output") return 3
    if (def.key === "Status") return 4
    if (def.key === "annotation" || def.key?.includes("metrics")) return 5
    if (def.key?.includes("evaluators")) return 6
    if (def.key === "__metrics_group__") return 7
    if (def.key === "errors") return 9 // ensure errors column stays at the end of metrics group
    return 8
}

const normalizeEvaluatorSlug = (slug?: string) =>
    slug ? slug.replace(/[\s._-]+/g, "").toLowerCase() : ""

const resolveEvaluatorFailure = (
    map: EvaluatorFailureMap | undefined,
    scenarioId: string,
    slug?: string,
) => {
    if (!map || !slug) return undefined
    const failures = map.get(scenarioId)
    if (!failures) return undefined
    if (failures[slug]) return failures[slug]
    const target = normalizeEvaluatorSlug(slug)
    if (!target) return undefined
    const entry = Object.entries(failures).find(
        ([candidateSlug]) => normalizeEvaluatorSlug(candidateSlug) === target,
    )
    return entry?.[1]
}

export function buildAntdColumns(
    cols: TableColumn[],
    runId: string,
    options: {
        evaluatorFailuresMap?: EvaluatorFailureMap
        expendedRows?: Record<string, boolean>
    } = {},
): EnhancedColumnType<TableRow>[] {
    const evaluatorFailuresMap = options?.evaluatorFailuresMap
    const expendedRows = options?.expendedRows
    const resolveStepKeyForRun = (column: TableColumn, targetRunId: string) => {
        return column.stepKeyByRunId?.[targetRunId] ?? column.stepKey
    }
    const distMap = runId ? evalAtomStore().get(runMetricsStatsCacheFamily(runId)) : {}
    const evalType = evalAtomStore().get(evalTypeAtom)

    const resolveComparisonBackground = (record?: TableRow) => {
        const compareIndex = (record as any)?.compareIndex
        if (compareIndex === undefined || compareIndex === null) return undefined
        const key = String(compareIndex)
        const color =
            (EVAL_BG_COLOR as Record<string, string>)[key] ??
            (typeof compareIndex === "number"
                ? (EVAL_BG_COLOR as Record<number, string>)[compareIndex]
                : undefined)
        if (color) {
            return {backgroundColor: color}
        }
        return undefined
    }

    const temporalCellClasses = (record?: TableRow) => {
        if (!record) return ""
        if ((record as any)?.compareIndex) return ""
        const bgClass =
            typeof record.temporalGroupIndex === "number" && record.temporalGroupIndex % 2 === 0
                ? "bg-slate-50"
                : "bg-white"
        const borderClass = record.isTemporalGroupStart
            ? "border-t border-slate-200 first:border-t-0"
            : ""
        return clsx(bgClass, borderClass)
    }

    const temporalContentPadding = (record?: TableRow) =>
        record?.isTemporalGroupStart ? "pt-3" : "pt-1"

    // Count how many input/output columns we have
    const inputColumns = cols.filter((col) => col.kind === "input")
    const outputColumns = cols.filter((col) => col.kind === "invocation")

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

            // Sorting:
            // - keep sorting for true numeric/boolean/string metrics
            // - disable sorting for annotation-like metric paths (their values come from annotations, not metrics atoms)
            const sortable =
                (c.kind === "metric" || c.kind === "annotation") &&
                !isAnnotationLikeMetricPath(c.path) &&
                isSortableMetricType(c.metricType)

            const sorter = sortable ? scenarioMetricSorter(c, runId) : undefined

            if (c.children) {
                // drop empty wrapper groups
                if ((!c.title && !c.name) || c.kind === "metrics_group") {
                    return {
                        ...common,
                        __editLabel: editLabel,
                        children: buildAntdColumns(c.children, runId, options),
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
                            const failure = resolveEvaluatorFailure(
                                evaluatorFailuresMap,
                                scenarioId,
                                evaluatorSlug,
                            )
                            if (failure) {
                                return (
                                    <EvaluatorFailureCell
                                        status={failure.status}
                                        error={failure.error}
                                    />
                                )
                            }
                            if (hasAnnotation) {
                                return (
                                    <CollapsedAnnotationValueCell
                                        scenarioId={scenarioId}
                                        runId={(record as any).runId || runId}
                                        childrenDefs={c.children!}
                                    />
                                )
                            }
                            return evalType === "auto" || evalType === "custom" ? (
                                <AutoEvalCollapsedMetricValueCell
                                    scenarioId={scenarioId}
                                    runId={(record as any).runId || runId}
                                    evaluatorSlug={evaluatorSlug}
                                    childrenDefs={c.children}
                                />
                            ) : (
                                <CollapsedMetricValueCell
                                    scenarioId={scenarioId}
                                    runId={(record as any).runId || runId}
                                    evaluatorSlug={evaluatorSlug}
                                    childrenDefs={c.children}
                                />
                            )
                        },
                        children: buildAntdColumns(c.children, runId, options),
                    }
                }

                return {
                    ...common,
                    __editLabel: editLabel,
                    title: titleCase(c.title ?? c.name),
                    key: c.key ?? c.name,
                    children: buildAntdColumns(c.children, runId, options),
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
                                    className: clsx(
                                        temporalCellClasses(record),
                                        showBorder && "!border-b-0",
                                        showBorder
                                            ? "!p-0"
                                            : record?.children?.length || record?.isComparison
                                              ? "!p-0"
                                              : undefined,
                                    ),
                                    style: resolveComparisonBackground(record),
                                }
                            },
                            render: (_: any, record: TableRow) => (
                                <CellWrapper
                                    className={clsx(
                                        record.isTemporalGroupStart
                                            ? "font-semibold text-gray-700"
                                            : "text-gray-500",
                                    )}
                                >
                                    {record.scenarioIndex}
                                </CellWrapper>
                            ),
                        }
                    case "timestamp":
                        return {
                            ...common,
                            width: 200,
                            minWidth: 180,
                            render: (_: any, record: TableRow) => {
                                const effectiveRunId = (record as any).runId || runId
                                return (
                                    <TimestampCell
                                        scenarioId={record.scenarioId || record.key}
                                        runId={effectiveRunId}
                                        timestamp={record.timestamp}
                                        isGroupStart={record.isTemporalGroupStart}
                                    />
                                )
                            },
                        }
                    case "action":
                        if (evalType === "auto" || evalType === "custom") return null
                        return {
                            ...common,
                            fixed: "right",
                            width: 120,
                            minWidth: 120,
                            render: (_: any, record: TableRow) => {
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
                const isFallbackInput = c.path === "__fallback_input__"
                if (isFallbackInput) {
                    return {
                        ...common,
                        title: (
                            <span className="flex items-center gap-1 whitespace-nowrap">
                                Inputs
                            </span>
                        ),
                        key: "inputs_group",
                        addNotAvailableCell: false,
                        onCell: (record) => {
                            const showBorder =
                                expendedRows?.[record.key] ||
                                (record?.isComparison && !record.isLastRow)
                            return {
                                className: clsx(
                                    temporalCellClasses(record),
                                    showBorder && "!border-b-0",
                                ),
                                style: resolveComparisonBackground(record),
                            }
                        },
                        render: (_: any, record: TableRow) => {
                            if (record.isComparison) return ""
                            const effectiveRunId = (record as any).runId || runId
                            const scenarioId = record.scenarioId || record.key
                            return (
                                <InputSummaryCell scenarioId={scenarioId} runId={effectiveRunId} />
                            )
                        },
                    }
                }

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
                            className: clsx(
                                temporalCellClasses(record),
                                showBorder && "!border-b-0",
                            ),
                            style: resolveComparisonBackground(record),
                        }
                    },
                    renderAggregatedData: ({record, isCollapsed}) => {
                        if (record.isComparison) return null
                        const effectiveRunId = (record as any).runId || runId
                        const scenarioId = record.scenarioId || record.key
                        const shouldShowPrefix = evalType !== "online"
                        return (
                            <div
                                className={clsx(
                                    "flex flex-col gap-2 group",
                                    temporalContentPadding(record),
                                )}
                            >
                                <Expandable
                                    expandKey={record.key}
                                    disableExpand={!isCollapsed}
                                    className="bg-transparent [&_.cell-expand-container]:!bg-transparent"
                                >
                                    {inputColumns.map((inputCol) => (
                                        <div
                                            key={inputCol.key}
                                            className={clsx(
                                                "text-wrap",
                                                record.isTemporalGroupStart && shouldShowPrefix
                                                    ? "text-gray-700"
                                                    : "text-gray-500",
                                            )}
                                        >
                                            {shouldShowPrefix ? (
                                                <span className="font-medium">
                                                    {titleCase(inputCol.name!)}:
                                                </span>
                                            ) : null}
                                            <div className="bg-transparent">
                                                <InputCell
                                                    scenarioId={scenarioId}
                                                    stepKey={resolveStepKeyForRun(
                                                        inputCol,
                                                        effectiveRunId,
                                                    )}
                                                    inputKey={inputCol.path}
                                                    showEditor={
                                                        shouldShowPrefix ? false : undefined
                                                    }
                                                    disableExpand={isCollapsed}
                                                />
                                            </div>
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
                                className: clsx(
                                    temporalCellClasses(record),
                                    showBorder && "!border-b-0",
                                ),
                                style: resolveComparisonBackground(record),
                            }
                        },
                        render: (_: any, record: TableRow) => {
                            if (record.isComparison) return ""
                            const shouldShowPrefix = evalType !== "online"
                            const effectiveRunId = (record as any).runId || runId
                            const scenarioId = record.scenarioId || record.key
                            return (
                                <InputCell
                                    scenarioId={scenarioId}
                                    stepKey={resolveStepKeyForRun(inputCol, effectiveRunId)}
                                    inputKey={inputCol.path}
                                    showEditor={shouldShowPrefix ? false : undefined}
                                />
                            )
                        },
                    })),
                }
            }

            if (c.kind === "invocation") {
                const createOutputColumnDef = (
                    outputCol: TableColumn,
                    idx: number,
                    totalOutputs: number,
                ) => {
                    const isOnlineEval = evalType === "online"
                    const isAutoEval = evalType === "auto" || evalType === "custom"
                    const useSingleColumnLayout = isOnlineEval || (isAutoEval && totalOutputs <= 1)
                    const outputKey = outputCol.name || outputCol.path || `output-${idx}`
                    const columnTitle = useSingleColumnLayout
                        ? "Output"
                        : titleCase(outputKey || `Output ${idx + 1}`)
                    const editLabelForOutput = useSingleColumnLayout
                        ? "Output"
                        : generateColumnTitle(outputCol)
                    return {
                        metricType: outputCol.metricType ?? outputCol.kind,
                        title: columnTitle,
                        key: useSingleColumnLayout
                            ? "output"
                            : (outputCol.key ?? `${outputKey}-output-${idx}`),
                        minWidth: generateColumnWidth(outputCol),
                        width: generateColumnWidth(outputCol),
                        __editLabel: editLabelForOutput,
                        addNotAvailableCell: false,
                        onCell: (record) => {
                            const showBorder =
                                expendedRows?.[record.key] ||
                                (record?.isComparison && !record.isLastRow)
                            return {
                                className: clsx(
                                    temporalCellClasses(record),
                                    showBorder && "!border-b-0",
                                ),
                            }
                        },
                        render: (_: any, record: TableRow) => {
                            const effectiveRunId = (record as any).runId || runId
                            const scenarioId = record.scenarioId || record.key
                            return (
                                <InvocationResultCell
                                    scenarioId={scenarioId}
                                    stepKey={resolveStepKeyForRun(outputCol, effectiveRunId)}
                                    path={outputCol.path}
                                    runId={effectiveRunId}
                                    record={record}
                                    isSkeleton={record.isSkeleton || false}
                                />
                            )
                        },
                    } as EnhancedColumnType<TableRow>
                }

                if (
                    evalType === "online" ||
                    ((evalType === "auto" || evalType === "custom") && outputColumns.length <= 1)
                ) {
                    const outputIndex = Math.max(outputColumns.indexOf(c), 0)
                    return createOutputColumnDef(c, outputIndex, outputColumns.length)
                }

                const isFirstOutput = outputColumns.length > 0 && outputColumns[0] === c
                if (!isFirstOutput) return null

                return {
                    title: (
                        <span className="flex items-center gap-1 whitespace-nowrap">Outputs</span>
                    ),
                    dataIndex: "outputs",
                    key: "outputs",
                    align: "left",
                    collapsible: true,
                    addNotAvailableCell: false,
                    onCell: (record) => {
                        const showBorder =
                            expendedRows?.[record.key] ||
                            (record?.isComparison && !record.isLastRow)
                        return {
                            className: clsx(
                                temporalCellClasses(record),
                                showBorder && "!border-b-0",
                            ),
                            style: resolveComparisonBackground(record),
                        }
                    },
                    renderAggregatedData: ({record}) => {
                        return (
                            <CellWrapper
                                className={clsx(
                                    "text-gray-500 italic text-xs",
                                    temporalContentPadding(record),
                                )}
                            >
                                <span>Expand the Outputs group to inspect invocation results.</span>
                            </CellWrapper>
                        )
                    },
                    children: outputColumns.map((outputCol, idx) =>
                        createOutputColumnDef(outputCol, idx, outputColumns.length),
                    ),
                }
            }

            // --------- Leaf cells ----------
            return {
                ...common,
                sorter,
                render: (_unused: any, record: TableRow) => {
                    const effectiveRunId = (record as any).runId || runId

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
                        case "metric": {
                            // If this “metric” is actually pointing inside annotations, render via AnnotationValueCell
                            // if (isAnnotationLikeMetricPath(c.path)) {
                            //     const annotationStepKey = resolveStepKeyForRun(c, effectiveRunId)
                            //     const fieldPath = toAnnotationFieldPath(c.path)
                            //     return (
                            //         <AnnotationValueCell
                            //             scenarioId={record.scenarioId || record.key}
                            //             fieldPath={fieldPath}
                            //             metricKey={c.name}
                            //             metricType={c.metricType}
                            //             fullKey={c.path}
                            //             distInfo={distMap[c.path]}
                            //             stepKey={annotationStepKey}
                            //             name={c.name}
                            //             runId={effectiveRunId}
                            //         />
                            //     )
                            // }

                            const scenarioId = record.scenarioId || record.key
                            const evaluatorSlug = (c as any).evaluatorSlug as string | undefined
                            const groupIndex = (c as any).evaluatorColumnIndex ?? 0
                            const groupCount = (c as any).evaluatorColumnCount ?? 1
                            const failure = resolveEvaluatorFailure(
                                evaluatorFailuresMap,
                                scenarioId,
                                evaluatorSlug,
                            )

                            if (failure) {
                                if (groupIndex === 0) {
                                    return {
                                        children: (
                                            <EvaluatorFailureCell
                                                status={failure.status}
                                                error={failure.error}
                                            />
                                        ),
                                        props: {colSpan: Math.max(groupCount, 1)},
                                    }
                                }
                                return {children: null, props: {colSpan: 0}}
                            }

                            return (
                                <MetricValueCell
                                    scenarioId={scenarioId}
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
                                    stepKey={resolveStepKeyForRun(c, effectiveRunId)}
                                />
                            )
                        }
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
