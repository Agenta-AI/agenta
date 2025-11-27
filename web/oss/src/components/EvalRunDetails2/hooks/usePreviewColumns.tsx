import {useEffect, useMemo, useCallback, useRef} from "react"
import type {ReactNode} from "react"

import {Typography} from "antd"

import type {ColumnTreeNode} from "@/oss/components/InfiniteVirtualTable"
import ColumnVisibilityMenuTrigger, {
    type ColumnVisibilityNodeMeta,
} from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityMenuTrigger"
import {humanizeMetricPath} from "@/oss/lib/evaluations/utils/metrics"

import {
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    EvaluationTableColumnsResult,
    MetricColumnDefinition,
} from "../atoms/table"
import type {PreviewTableRow} from "../atoms/tableRows"
import PreviewEvaluationInputCell from "../components/TableCells/InputCell"
import StepGroupHeader from "../components/TableHeaders/StepGroupHeader"
import {buildPreviewColumns, SkeletonRenderContext} from "../utils/buildPreviewColumns"
import {buildSkeletonColumnResult} from "../utils/buildSkeletonColumns"
import {
    formatReferenceLabel,
    humanizeIdentifier,
    humanizeStepKey,
    titleize,
} from "../utils/labelHelpers"

type TableRowData = PreviewTableRow

export interface PreviewColumnsArgs {
    columnResult: EvaluationTableColumnsResult | undefined
    evaluationType: "auto" | "human"
}

export interface PreviewColumnsResult {
    columns: ReturnType<typeof buildPreviewColumns<TableRowData>>["columns"]
    staticMetricColumns: {
        auto: MetricColumnDefinition[]
        human: MetricColumnDefinition[]
    }
    evaluators: EvaluationTableColumnsResult["evaluators"]
    loadedColumnGroups: EvaluationTableColumnGroup[]
    ungroupedColumns: EvaluationTableColumn[]
}

const selectColumnsForType = (
    result: EvaluationTableColumnsResult | undefined,
    evaluationType: "auto" | "human",
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

const usePreviewColumns = ({
    columnResult,
    evaluationType,
}: PreviewColumnsArgs): PreviewColumnsResult => {
    const columnData = useMemo(
        () => selectColumnsForType(columnResult, evaluationType),
        [columnResult, evaluationType],
    )

    const metricsForType = useMemo(
        () =>
            evaluationType === "auto"
                ? columnData.staticMetricColumns.auto
                : columnData.staticMetricColumns.human,
        [columnData.staticMetricColumns, evaluationType],
    )

    const getRenderer = useMemo(
        () => (column: EvaluationTableColumn) => {
            if (column.stepType !== "input") return undefined
            return (_: unknown, record: TableRowData) => (
                <PreviewEvaluationInputCell scenarioId={record.scenarioId} column={column} />
            )
        },
        [],
    )

    const isSkeletonRecord = useCallback((record: TableRowData) => Boolean(record.__isSkeleton), [])

    const renderSkeletonCell = useCallback((context: SkeletonRenderContext<TableRowData>) => {
        const wrap = (node: ReactNode) => (
            <div className="min-h-[100px] flex flex-col justify-center">{node}</div>
        )

        const createBar = (width?: number | string) =>
            wrap(
                <div
                    className="h-3 rounded bg-neutral-200 animate-pulse"
                    style={{
                        width: typeof width === "number" ? `${width}px` : (width ?? "100%"),
                        maxWidth: "100%",
                        display: "inline-block",
                    }}
                />,
            )

        if (context.type === "column") {
            if (context.column.metaRole === "scenarioIndexStatus") {
                return createBar(32)
            }
            if (context.column.stepType === "metric") {
                return createBar(80)
            }
            if (context.column.stepType === "meta") {
                return createBar(64)
            }
        }

        if (context.type === "staticMetric") {
            return createBar(80)
        }

        return createBar()
    }, [])

    const baseColumnsResult = useMemo(
        () =>
            buildPreviewColumns<TableRowData>({
                columns: columnData.columns,
                groups: columnData.groups,
                ungroupedColumns: columnData.ungroupedColumns,
                staticMetricColumns: columnData.staticMetricColumns,
                evaluationType,
                getRenderer,
                isSkeletonRow: isSkeletonRecord,
                renderSkeleton: renderSkeletonCell,
            }),
        [columnData, evaluationType, getRenderer, isSkeletonRecord, renderSkeletonCell],
    )

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
        if (!metricsForType.length) return map

        columnData.groups
            .filter((group) => group.kind === "metric")
            .forEach((group) => {
                metricsForType.forEach((metric) => {
                    map.set(`${group.id}::${metric.path}`, {metric, group})
                })
            })

        return map
    }, [columnData.groups, metricsForType])

    const loggedVisibilityMetaRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        loggedVisibilityMetaRef.current.clear()
    }, [columnData.columns, columnData.groups])

    const resolveNodeMeta = useCallback(
        (node: ColumnTreeNode): ColumnVisibilityNodeMeta => {
            const key = String(node.key)
            const logMeta = (
                meta: ColumnVisibilityNodeMeta,
                context: Record<string, unknown>,
            ): ColumnVisibilityNodeMeta => {
                const seen = loggedVisibilityMetaRef.current
                if (!seen.has(key)) {
                    seen.add(key)
                    console.info("[EvalRunDetails2][ColumnVisibility][resolveNodeMeta]", {
                        nodeKey: key,
                        nodeLabel: node.label ?? null,
                        ...context,
                        searchValues: meta.searchValues,
                        hasTitle: Boolean(meta.title),
                    })
                }
                return meta
            }

            const group = visibilityGroupMap.get(key)
            if (group) {
                const label =
                    resolveGroupLabel(group) ??
                    group.label ??
                    node.label ??
                    humanizeStepKey(group.id, group.kind)
                const groupTitle =
                    group.kind === "input" || group.kind === "invocation" ? (
                        <StepGroupHeader group={group} fallbackLabel={label ?? key} />
                    ) : (
                        <VisibilityNodeTitle label={label ?? key} emphasize />
                    )
                return logMeta(
                    {
                        title: groupTitle,
                        searchValues: [label ?? "", group.id, group.kind],
                    },
                    {type: "group", groupId: group.id, label},
                )
            }

            const column = visibilityColumnMap.get(key)
            if (column) {
                const groupLabel = column.groupId
                    ? visibilityGroupMap.get(column.groupId)?.label
                    : undefined
                const label =
                    column.displayLabel ??
                    column.label ??
                    (column.metricKey ? normalizeMetricLabel(column.metricKey) : undefined) ??
                    node.label ??
                    key

                return logMeta(
                    {
                        title: <VisibilityNodeTitle label={label ?? key} emphasize={!groupLabel} />,
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
                    },
                    {
                        type: "column",
                        columnId: column.id,
                        columnLabel: column.label,
                        displayLabel: column.displayLabel,
                        groupId: column.groupId ?? null,
                        groupLabel,
                    },
                )
            }

            const staticMetric = visibilityStaticMetricMap.get(key)
            if (staticMetric) {
                const metricLabel =
                    staticMetric.metric.displayLabel ??
                    normalizeMetricLabel(staticMetric.metric.path) ??
                    titleize(staticMetric.metric.name) ??
                    staticMetric.metric.name ??
                    key
                const groupLabel = staticMetric.group?.label ?? staticMetric.group?.id
                return logMeta(
                    {
                        title: (
                            <VisibilityNodeTitle
                                label={metricLabel}
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
                    },
                    {
                        type: "staticMetric",
                        metricPath: staticMetric.metric.path,
                        metricName: staticMetric.metric.name,
                        groupId: staticMetric.group?.id ?? null,
                        groupLabel,
                    },
                )
            }

            const fallback =
                node.label ?? (typeof node.titleNode === "string" ? node.titleNode : null)
            return logMeta(
                {
                    title: (
                        <VisibilityNodeTitle
                            label={fallback ?? key}
                            emphasize={Boolean(node.children?.length)}
                        />
                    ),
                    searchValues: [fallback ?? "", key],
                },
                {type: "fallback", fallback},
            )
        },
        [visibilityColumnMap, visibilityGroupMap, visibilityStaticMetricMap],
    )

    const visibilityVersion = useMemo(
        () =>
            `${columnData.groups.map((group) => group.id).join("|")}::${columnData.columns
                .map((col) => col.id)
                .join("|")}`,
        [columnData.columns, columnData.groups],
    )

    const columnsWithVisibilityTrigger = useMemo(() => {
        const triggerColumn = {
            key: `__column_visibility__:${visibilityVersion}`,
            title: <ColumnVisibilityMenuTrigger variant="icon" resolveNodeMeta={resolveNodeMeta} />,
            width: 48,
            fixed: "right" as const,
            align: "center" as const,
            columnVisibilityLocked: true,
            dataIndex: "__column_visibility__",
            render: () => null,
        }
        return [...baseColumnsResult.columns, triggerColumn]
    }, [baseColumnsResult.columns, resolveNodeMeta, visibilityVersion])

    return {
        columns: columnsWithVisibilityTrigger,
        evaluators: columnData.evaluators,
        staticMetricColumns: columnData.staticMetricColumns,
        loadedColumnGroups: columnData.groups,
        ungroupedColumns: columnData.ungroupedColumns,
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

function resolveGroupLabel(group: EvaluationTableColumnGroup) {
    const meta = group.meta ?? {}
    const refs = (meta.refs ?? {}) as Record<string, any>
    const stepRole = (meta.stepRole as string | undefined) ?? (group.kind as string | undefined)

    if (stepRole === "input") {
        const testsetName =
            humanizeIdentifier(refs.testset?.name) ??
            humanizeIdentifier(refs.testset?.slug) ??
            formatReferenceLabel(refs.testset)
        if (testsetName) {
            return `Testset ${testsetName}`
        }

        const queryLabel =
            formatReferenceLabel(refs.query) ?? formatReferenceLabel(refs.query_revision)
        if (queryLabel) {
            return `Query ${queryLabel}`
        }
    }

    if (stepRole === "invocation") {
        const applicationLabel =
            humanizeIdentifier(refs.application?.name) ??
            humanizeIdentifier(refs.application?.slug) ??
            formatReferenceLabel(refs.application) ??
            formatReferenceLabel(refs.agent) ??
            formatReferenceLabel(refs.tool)
        const variantLabel =
            humanizeIdentifier(refs.application_variant?.name) ??
            humanizeIdentifier(refs.variant?.name) ??
            formatReferenceLabel(refs.application_variant) ??
            formatReferenceLabel(refs.variant)

        const revisionVersion =
            refs.application_revision?.version ?? refs.application_revision?.revision ?? null

        const parts = []
        if (applicationLabel) parts.push(`Application ${applicationLabel}`)
        if (variantLabel && variantLabel !== applicationLabel) parts.push(`Variant ${variantLabel}`)
        if (revisionVersion) parts.push(`Rev ${revisionVersion}`)
        if (parts.length) return parts.join(" · ")
    }

    return null
}

function VisibilityNodeTitle({
    label,
    secondary,
    emphasize,
}: {
    label: string
    secondary?: ReactNode
    emphasize?: boolean
}) {
    return (
        <div className="flex flex-col leading-tight">
            <Typography.Text className={emphasize ? "font-semibold text-sm" : "text-sm"} ellipsis>
                {label}
            </Typography.Text>
            {secondary ? (
                <Typography.Text type="secondary" className="text-xs" ellipsis>
                    {secondary}
                </Typography.Text>
            ) : null}
        </div>
    )
}

export default usePreviewColumns
