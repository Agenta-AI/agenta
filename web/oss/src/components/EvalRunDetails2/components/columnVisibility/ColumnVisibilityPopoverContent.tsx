import {useMemo, useCallback, useEffect, useRef} from "react"

import {Typography} from "antd"

import type {ColumnTreeNode, ColumnVisibilityState} from "@/oss/components/InfiniteVirtualTable"
import ColumnVisibilityPopoverContentBase, {
    type ColumnVisibilityNodeMeta,
} from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityPopoverContent"
import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"

import {
    type EvaluationTableColumn,
    type EvaluationTableColumnGroup,
    type EvaluationTableColumnsResult,
    type MetricColumnDefinition,
} from "../../atoms/table"
import usePreviewTableData from "../../hooks/usePreviewTableData"
import {buildSkeletonColumnResult} from "../../utils/buildSkeletonColumns"
import {resolveGroupLabel, humanizeStepKey, titleize} from "../../utils/labelHelpers"
import StepGroupHeader from "../TableHeaders/StepGroupHeader"

type EvaluationType = "auto" | "human"

interface ScenarioColumnVisibilityPopoverContentProps {
    runId: string
    evaluationType: EvaluationType
    controls?: ColumnVisibilityState<any>
    onClose: () => void
    scopeId?: string | null
}

const selectColumnsForType = (
    result: EvaluationTableColumnsResult | undefined,
    evaluationType: EvaluationType,
) => {
    if (
        !result ||
        result.groups.length === 0 ||
        result.columns.every((column) => column.kind === "meta")
    ) {
        return buildSkeletonColumnResult(evaluationType)
    }

    const relevantGroups = result.groups.filter((group) => {
        if (group.kind !== "metric") return true
        return evaluationType === "auto"
            ? group.id.includes("metrics:auto")
            : group.id.includes("metrics:human")
    })

    const staticMetrics =
        evaluationType === "auto"
            ? {auto: result.staticMetricColumns.auto, human: [] as MetricColumnDefinition[]}
            : {auto: [] as MetricColumnDefinition[], human: result.staticMetricColumns.human}

    return {
        columns: result.columns,
        groups: relevantGroups,
        ungroupedColumns: result.ungroupedColumns,
        staticMetricColumns: staticMetrics,
        evaluators: result.evaluators,
    }
}

const OUTPUT_METRIC_PATH_PREFIX = /^attributes\.ag\.data\.outputs\.?/i

function stripOutputsNamespace(value?: string | null) {
    if (!value) return null
    const stripped = value.replace(OUTPUT_METRIC_PATH_PREFIX, "")
    return stripped.length ? stripped : "output"
}

function normalizeMetricLabel(metricKey?: string | null) {
    if (!metricKey) return undefined
    const normalized = stripOutputsNamespace(metricKey) ?? metricKey
    if (!normalized) return undefined
    return humanizeMetricPath(normalized) || normalized
}

const ScenarioColumnVisibilityPopoverContent = ({
    runId,
    evaluationType,
    controls,
    onClose,
    scopeId,
}: ScenarioColumnVisibilityPopoverContentProps) => {
    const {columnResult} = usePreviewTableData({runId})

    const hasLoggedInit = useRef(false)
    useEffect(() => {
        if (hasLoggedInit.current) return
        console.info("[EvalRunDetails2][ColumnVisibilityPopover] mount", {
            runId,
            evaluationType,
            scopeId: scopeId ?? runId,
        })
        hasLoggedInit.current = true
    }, [evaluationType, runId, scopeId])

    useEffect(() => {
        console.info("[EvalRunDetails2][ColumnVisibilityPopover] columnResult", {
            runId,
            evaluationType,
            hasResult: Boolean(columnResult),
            columnCount: columnResult?.columns?.length ?? 0,
            groupCount: columnResult?.groups?.length ?? 0,
        })
    }, [columnResult, evaluationType, runId])

    const columnData = useMemo(
        () => selectColumnsForType(columnResult, evaluationType),
        [columnResult, evaluationType],
    )

    useEffect(() => {
        console.info("[EvalRunDetails2][ColumnVisibilityPopover] labels snapshot", {
            runId,
            evaluationType,
            groups: columnData.groups.map((group) => ({
                id: group.id,
                label: group.label,
                resolvedLabel: resolveGroupLabel(group),
                kind: group.kind,
            })),
            columns: columnData.columns.map((column) => ({
                id: column.id,
                label: column.label,
                displayLabel: column.displayLabel,
                groupId: column.groupId,
                metricKey: column.metricKey,
            })),
        })
    }, [columnData, evaluationType, runId])

    const visibilityColumnMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumn>()
        columnData.columns.forEach((column) => {
            map.set(column.id, column)
        })
        return map
    }, [columnData.columns])

    const visibilityGroupMap = useMemo(() => {
        const map = new Map<string, EvaluationTableColumnGroup>()
        columnData.groups.forEach((group) => {
            map.set(group.id, group)
        })
        return map
    }, [columnData.groups])

    const visibilityStaticMetricMap = useMemo(() => {
        const map = new Map<
            string,
            {metric: MetricColumnDefinition; group?: EvaluationTableColumnGroup}
        >()
        const metricsForType =
            evaluationType === "auto"
                ? columnData.staticMetricColumns.auto
                : columnData.staticMetricColumns.human

        if (!metricsForType.length) return map

        columnData.groups
            .filter((group) => group.kind === "metric")
            .forEach((group) => {
                metricsForType.forEach((metric) => {
                    map.set(`${group.id}::${metric.path}`, {metric, group})
                })
            })

        return map
    }, [columnData.groups, columnData.staticMetricColumns, evaluationType])

    const resolveNodeMeta = useCallback(
        (node: ColumnTreeNode): ColumnVisibilityNodeMeta => {
            const key = String(node.key)
            const titleFallback = node.titleNode ?? node.label ?? key

            const group = visibilityGroupMap.get(key)
            if (group) {
                const label =
                    resolveGroupLabel(group) ??
                    group.label ??
                    (humanizeStepKey(group.id, group.kind) || "")
                const groupTitle =
                    group.kind === "input" || group.kind === "invocation" ? (
                        <StepGroupHeader group={group} fallbackLabel={label ?? key} />
                    ) : (
                        <VisibilityNodeTitle label={label || String(titleFallback)} emphasize />
                    )
                const payload = {
                    title: groupTitle,
                    searchValues: [label ?? "", group.id, group.kind],
                }
                console.info("[EvalRunDetails2][ColumnVisibilityPopover] resolve group", {
                    nodeKey: key,
                    label,
                    groupId: group.id,
                    kind: group.kind,
                    searchValues: payload.searchValues,
                })
                return payload
            }

            const column = visibilityColumnMap.get(key)
            if (column) {
                const groupLabel = column.groupId
                    ? visibilityGroupMap.get(column.groupId)?.label
                    : undefined
                const label =
                    column.displayLabel ??
                    column.label ??
                    (normalizeMetricLabel(column.metricKey) || "")

                const payload = {
                    title:
                        label || groupLabel ? (
                            <VisibilityNodeTitle
                                label={label || String(titleFallback)}
                                emphasize={!groupLabel}
                            />
                        ) : (
                            (titleFallback ?? (
                                <VisibilityNodeTitle label={String(key)} emphasize={!groupLabel} />
                            ))
                        ),
                    searchValues: [
                        label ?? "",
                        column.label,
                        column.displayLabel,
                        column.metricKey,
                        column.path,
                        column.stepKey,
                        groupLabel,
                        key,
                    ],
                }
                console.info("[EvalRunDetails2][ColumnVisibilityPopover] resolve column", {
                    nodeKey: key,
                    columnId: column.id,
                    label,
                    groupLabel,
                    metricKey: column.metricKey ?? null,
                    path: column.path,
                    searchValues: payload.searchValues,
                })
                return payload
            }

            const staticMetric = visibilityStaticMetricMap.get(key)
            if (staticMetric) {
                const metricLabel =
                    staticMetric.metric.displayLabel ??
                    normalizeMetricLabel(staticMetric.metric.path) ??
                    titleize(staticMetric.metric.name) ??
                    (staticMetric.metric.name || "")
                const groupLabel = staticMetric.group?.label ?? staticMetric.group?.id
                const payload = {
                    title: (
                        <VisibilityNodeTitle
                            label={metricLabel || String(titleFallback)}
                            secondary={groupLabel}
                            emphasize={!groupLabel}
                        />
                    ),
                    searchValues: [
                        metricLabel,
                        staticMetric.metric.path,
                        staticMetric.metric.name,
                        groupLabel,
                        key,
                    ],
                }
                console.info("[EvalRunDetails2][ColumnVisibilityPopover] resolve static metric", {
                    nodeKey: key,
                    metricPath: staticMetric.metric.path,
                    metricName: staticMetric.metric.name,
                    groupLabel,
                    searchValues: payload.searchValues,
                })
                return payload
            }

            const fallback =
                (typeof node.titleNode === "string" ? node.titleNode : null) ??
                (typeof node.label === "string" ? node.label : null)
            const payload = {
                title: (
                    <VisibilityNodeTitle
                        label={fallback ?? String(titleFallback ?? key)}
                        emphasize={Boolean(node.children?.length)}
                    />
                ),
                searchValues: [fallback ?? "", key],
            }
            console.info("[EvalRunDetails2][ColumnVisibilityPopover] resolve fallback", {
                nodeKey: key,
                fallback,
                searchValues: payload.searchValues,
            })
            return payload
        },
        [
            visibilityColumnMap,
            visibilityGroupMap,
            visibilityStaticMetricMap,
            humanizeStepKey,
            resolveGroupLabel,
            normalizeMetricLabel,
            titleize,
        ],
    )

    return (
        <ColumnVisibilityPopoverContentBase
            onClose={onClose}
            controls={controls}
            scopeId={scopeId ?? runId}
            resolveNodeMeta={resolveNodeMeta}
        />
    )
}

const VisibilityNodeTitle = ({
    label,
    secondary,
    emphasize,
}: {
    label: string
    secondary?: string | null
    emphasize?: boolean
}) => (
    <div className="flex flex-col leading-tight">
        <Typography.Text className={emphasize ? "font-semibold" : ""} ellipsis>
            {label}
        </Typography.Text>
        {secondary ? (
            <Typography.Text type="secondary" ellipsis>
                {secondary}
            </Typography.Text>
        ) : null}
    </div>
)

export default ScenarioColumnVisibilityPopoverContent
