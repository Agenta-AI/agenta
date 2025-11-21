import React from "react"

import {Tooltip} from "antd"
import clsx from "clsx"
import type {ColumnsType, ColumnType} from "antd/es/table"
import {ColumnVisibilityHeader} from "@/oss/components/InfiniteVirtualTable"

import type {
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    MetricColumnDefinition,
} from "../atoms/table"

import PreviewEvaluationInputCell from "../components/TableCells/InputCell"
import PreviewEvaluationInvocationCell from "../components/TableCells/InvocationCell"
import PreviewEvaluationMetricCell from "../components/TableCells/MetricCell"
import PreviewEvaluationActionCell from "../components/TableCells/ActionCell"
import {COLUMN_WIDTHS} from "../constants/table"
import StepGroupHeader from "../components/TableHeaders/StepGroupHeader"

const TITLEIZE = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const renderEllipsisTitle = (label?: string | null) => {
    if (!label) return null
    return (
        <Tooltip title={label} placement="top">
            <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-left">
                {label}
            </span>
        </Tooltip>
    )
}

const wrapHeader = (columnKey: string, content: React.ReactNode) => (
    <ColumnVisibilityHeader columnKey={columnKey}>{content ?? columnKey}</ColumnVisibilityHeader>
)

const STATUS_STYLE_MAP: Record<string, {dotClass: string; textClass: string}> = {
    success: {
        dotClass: "bg-emerald-500",
        textClass: "text-emerald-700",
    },
    failed: {
        dotClass: "bg-red-500",
        textClass: "text-red-700",
    },
    error: {
        dotClass: "bg-red-500",
        textClass: "text-red-700",
    },
    running: {
        dotClass: "bg-blue-500",
        textClass: "text-blue-700",
    },
    queued: {
        dotClass: "bg-amber-400",
        textClass: "text-amber-700",
    },
    pending: {
        dotClass: "bg-amber-400",
        textClass: "text-amber-700",
    },
    default: {
        dotClass: "bg-neutral-400",
        textClass: "text-neutral-700",
    },
}

const formatStatusLabel = (status: string | undefined): string => {
    if (!status) return "Status Unknown"
    return status
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())
}

export type SkeletonRenderContext<RowType> =
    | {
          type: "column"
          column: EvaluationTableColumn
          record: RowType
          value: unknown
          rowIndex: number
      }
    | {
          type: "staticMetric"
          metric: MetricColumnDefinition
          groupId: string
          record: RowType
          value: unknown
          rowIndex: number
      }

export interface BuildPreviewColumnsArgs<RowType> {
    columns: EvaluationTableColumn[]
    groups: EvaluationTableColumnGroup[]
    ungroupedColumns: EvaluationTableColumn[]
    staticMetricColumns: {
        auto: MetricColumnDefinition[]
        human: MetricColumnDefinition[]
    }
    evaluationType: "auto" | "human"
    getRenderer?: (column: EvaluationTableColumn) => ColumnType<RowType>["render"] | undefined
    isSkeletonRow?: (record: RowType) => boolean
    renderSkeleton?: (context: SkeletonRenderContext<RowType>) => React.ReactNode
}

export interface BuildPreviewColumnsResult<RowType> {
    columns: ColumnsType<RowType>
}

const createStaticMetricColumns = <RowType,>(
    groupId: string,
    metrics: MetricColumnDefinition[],
    options: {
        isSkeletonRow?: (record: RowType) => boolean
        getSkeletonContent: (context: SkeletonRenderContext<RowType>) => React.ReactNode
    },
): ColumnType<RowType>[] =>
    metrics.map((metric) => {
        const pseudoColumn: EvaluationTableColumn = {
            id: `${groupId}::${metric.path}`,
            label: metric.name,
            displayLabel: metric.displayLabel ?? metric.name,
            kind: "metric",
            stepKey: metric.stepKey,
            path: metric.path,
            pathSegments: metric.path.split("."),
            stepType: "metric",
            valueKey: metric.path.split(".").pop(),
            metricKey: metric.path,
            metricType: metric.metricType,
        }

        const baseRender: ColumnType<RowType>["render"] = (_value, record: any) => (
            <PreviewEvaluationMetricCell
                scenarioId={record.scenarioId ?? record.id}
                runId={record.runId}
                column={pseudoColumn}
            />
        )

        const metricColumnWidth = COLUMN_WIDTHS.metric

        const headerLabel = metric.displayLabel ?? TITLEIZE(metric.name)
        const titleNode = renderEllipsisTitle(headerLabel)

        if (!options.isSkeletonRow) {
            return {
                key: `${groupId}::${metric.path}`,
                title: wrapHeader(pseudoColumn.id, titleNode ?? headerLabel ?? pseudoColumn.id),
                width: metricColumnWidth,
                minWidth: metricColumnWidth,
                ellipsis: true,
                render: baseRender,
            }
        }

        const render: ColumnType<RowType>["render"] = (value, record, index) => {
            if (options.isSkeletonRow?.(record)) {
                return options.getSkeletonContent({
                    type: "staticMetric",
                    metric,
                    groupId,
                    record,
                    value,
                    rowIndex: typeof index === "number" ? index : 0,
                })
            }

            return baseRender(value, record, index)
        }

        return {
            key: `${groupId}::${metric.path}`,
            title: wrapHeader(pseudoColumn.id, titleNode ?? headerLabel ?? pseudoColumn.id),
            width: metricColumnWidth,
            minWidth: metricColumnWidth,
            ellipsis: true,
            render,
        }
    })

export function buildPreviewColumns<RowType>({
    columns,
    groups,
    ungroupedColumns,
    staticMetricColumns,
    evaluationType,
    getRenderer,
    isSkeletonRow,
    renderSkeleton,
}: BuildPreviewColumnsArgs<RowType>): BuildPreviewColumnsResult<RowType> {
    const columnsMap = new Map(columns.map((column) => [column.id, column]))
    const metricsForType =
        evaluationType === "auto" ? staticMetricColumns.auto : staticMetricColumns.human

    const defaultSkeleton = () => (
        <div className="h-3 w-full rounded bg-neutral-200 animate-pulse" />
    )

    const getSkeletonContent = (context: SkeletonRenderContext<RowType>) =>
        renderSkeleton?.(context) ?? defaultSkeleton()

    const wrapRender = (
        column: EvaluationTableColumn,
        baseRender: ColumnType<RowType>["render"],
    ): ColumnType<RowType>["render"] => {
        if (!isSkeletonRow) {
            return baseRender
        }

        return (value, record, index) => {
            if (isSkeletonRow(record)) {
                return getSkeletonContent({
                    type: "column",
                    column,
                    record,
                    value,
                    rowIndex: typeof index === "number" ? index : 0,
                })
            }

            return baseRender?.(value, record, index)
        }
    }

    const buildLeafColumn = (column: EvaluationTableColumn): ColumnType<RowType> | null => {
        const widthByStepType: Record<string, number> = {
            meta: 80,
            input: COLUMN_WIDTHS.input,
            invocation: COLUMN_WIDTHS.response,
            output: COLUMN_WIDTHS.response,
            annotation: COLUMN_WIDTHS.metric,
            metric: COLUMN_WIDTHS.metric,
        }

        const metaRoleWidths: Record<string, number> = {
            scenarioIndexStatus: 72,
            action: 120,
            timestamp: 200,
        }

        const columnType = column.stepType ?? column.kind
        let width =
            widthByStepType[columnType] ??
            (column.kind === "input" && column.id?.includes("groundTruth")
                ? COLUMN_WIDTHS.groundTruth
                : COLUMN_WIDTHS.metric)

        if (columnType === "meta") {
            if (column.metaRole && metaRoleWidths[column.metaRole] !== undefined) {
                width = metaRoleWidths[column.metaRole]
            } else if (column.path && metaRoleWidths[column.path]) {
                width = metaRoleWidths[column.path]
            }
        } else if (columnType === "input") {
            if (column.metricKey?.includes("groundTruth") || column.id?.includes("groundTruth")) {
                width = COLUMN_WIDTHS.groundTruth
            }
        }

        if (column.stepType === "meta") {
            if (column.metaRole === "scenarioIndexStatus") {
                const headerLabel = column.displayLabel ?? column.label
                const titleNode = renderEllipsisTitle(headerLabel)
                const baseRender: ColumnType<RowType>["render"] = (
                    value: number | string,
                    record: any,
                ) => {
                    const statusRaw = String(record?.status ?? "unknown")
                    const statusKey = statusRaw.toLowerCase()
                    const style = STATUS_STYLE_MAP[statusKey] ?? STATUS_STYLE_MAP.default
                    const displayValue = value ?? "—"
                    const tooltipLabel = formatStatusLabel(statusRaw)

                    return (
                        <div className="flex h-full min-h-[54px] w-full items-center justify-start">
                            <Tooltip title={tooltipLabel} placement="topLeft">
                                <span className="inline-flex items-center gap-2 text-xs font-medium">
                                    <span
                                        className={clsx("h-2 w-2 rounded-full", style.dotClass)}
                                    />
                                    <span className={clsx(style.textClass)}>{displayValue}</span>
                                </span>
                            </Tooltip>
                        </div>
                    )
                }
                return {
                    key: column.id,
                    dataIndex: "scenarioIndex",
                    title: wrapHeader(column.id, titleNode ?? headerLabel ?? column.id),
                    width,
                    minWidth: width,
                    fixed: column.sticky,
                    render: wrapRender(column, baseRender),
                    align: "left",
                }
            }
            if (column.metaRole === "action") {
                const headerLabel = column.displayLabel ?? column.label
                const titleNode = renderEllipsisTitle(headerLabel)
                const baseRender: ColumnType<RowType>["render"] = (_: unknown, record: any) => (
                    <PreviewEvaluationActionCell
                        scenarioId={record.scenarioId ?? record.id}
                        runId={record.runId}
                    />
                )
                return {
                    key: column.id,
                    title: wrapHeader(column.id, titleNode ?? headerLabel ?? column.id),
                    width,
                    minWidth: width,
                    fixed: column.sticky,
                    render: wrapRender(column, baseRender),
                }
            }
        }

        const fallbackRender: ColumnType<RowType>["render"] = () => (
            <span className="text-xs text-neutral-500">
                {column.description || column.path || column.metricType || "—"}
            </span>
        )

        const customRender = getRenderer?.(column)

        const renderByStepType: ColumnType<RowType>["render"] | undefined = (() => {
            if (column.stepType === "input") {
                return (_: unknown, record: any) => (
                    <PreviewEvaluationInputCell
                        scenarioId={record.scenarioId ?? record.id}
                        runId={record.runId}
                        column={column}
                    />
                )
            }
            if (column.stepType === "invocation") {
                return (_: unknown, record: any) => (
                    <PreviewEvaluationInvocationCell
                        scenarioId={record.scenarioId ?? record.id}
                        runId={record.runId}
                        column={column}
                    />
                )
            }
            if (column.stepType === "annotation" || column.stepType === "metric") {
                return (_: unknown, record: any) => (
                    <PreviewEvaluationMetricCell
                        scenarioId={record.scenarioId ?? record.id}
                        runId={record.runId}
                        column={column}
                    />
                )
            }
            return undefined
        })()

        const baseRender = renderByStepType ?? customRender ?? fallbackRender

        const headerLabel = column.displayLabel ?? TITLEIZE(column.label)
        const titleNode = renderEllipsisTitle(headerLabel)

        return {
            key: column.id,
            title: wrapHeader(column.id, titleNode ?? headerLabel ?? column.id),
            width,
            minWidth: width,
            ellipsis: true,
            align: "left",
            render: wrapRender(column, baseRender),
        }
    }

    const orderedGroups = [...groups].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    const builtColumns: ColumnsType<RowType> = []
    const renderedColumnIds = new Set<string>()

    const leadingMetaColumns = [...columns]
        .filter((column) => column.stepType === "meta" && column.metaRole === "scenarioIndexStatus")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    leadingMetaColumns.forEach((column) => {
        const leaf = buildLeafColumn(column)
        if (leaf) {
            builtColumns.push(leaf)
            renderedColumnIds.add(column.id)
        }
    })

    orderedGroups.forEach((group) => {
        const children: ColumnType<RowType>[] = []

        group.columnIds.forEach((columnId) => {
            const column = columnsMap.get(columnId)
            if (!column) return
            if (renderedColumnIds.has(columnId)) return
            const leaf = buildLeafColumn(column)
            if (leaf) {
                children.push(leaf)
            }
        })

        if (group.kind === "metric" && metricsForType.length) {
            const staticColumns = createStaticMetricColumns<RowType>(group.id, metricsForType, {
                isSkeletonRow,
                getSkeletonContent,
            })
            children.push(...staticColumns)
        }

        if (children.length === 0) {
            return
        }

        const groupLabel = group.label ?? ""
        const titleNode =
            group.kind === "input" || group.kind === "invocation" ? (
                <StepGroupHeader group={group} fallbackLabel={groupLabel} />
            ) : groupLabel ? (
                <Tooltip title={groupLabel} placement="top">
                    <span
                        style={{
                            display: "block",
                            maxWidth: "100%",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            textAlign: "left",
                        }}
                    >
                        {groupLabel}
                    </span>
                </Tooltip>
            ) : null

        builtColumns.push({
            key: group.id,
            title: titleNode,
            align: "left",
            children,
        })
    })

    const leftover = [...ungroupedColumns].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    leftover.forEach((column) => {
        if (renderedColumnIds.has(column.id)) return
        const leaf = buildLeafColumn(column)
        if (leaf) builtColumns.push(leaf)
    })

    if (builtColumns.length === 0) {
        builtColumns.push({
            key: "__fallback__",
            title: wrapHeader("__fallback__", "Columns"),
        })
    }

    return {columns: builtColumns}
}
