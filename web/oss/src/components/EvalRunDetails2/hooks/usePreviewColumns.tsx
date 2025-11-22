import {useMemo, useCallback} from "react"
import type {ReactNode} from "react"

import ColumnVisibilityMenuTrigger from "@/oss/components/InfiniteVirtualTable/components/columnVisibility/ColumnVisibilityMenuTrigger"

import {
    EvaluationTableColumn,
    EvaluationTableColumnGroup,
    EvaluationTableColumnsResult,
    MetricColumnDefinition,
} from "../atoms/table"
import type {PreviewTableRow} from "../atoms/tableRows"
import PreviewEvaluationInputCell from "../components/TableCells/InputCell"
import {buildPreviewColumns, SkeletonRenderContext} from "../utils/buildPreviewColumns"
import {buildSkeletonColumnResult} from "../utils/buildSkeletonColumns"

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

    const columnsWithVisibilityTrigger = useMemo(() => {
        const triggerColumn = {
            key: "__column_visibility__",
            title: <ColumnVisibilityMenuTrigger variant="icon" />,
            width: 48,
            fixed: "right" as const,
            align: "center" as const,
            columnVisibilityLocked: true,
            dataIndex: "__column_visibility__",
            render: () => null,
        }
        return [...baseColumnsResult.columns, triggerColumn]
    }, [baseColumnsResult.columns])

    return {
        columns: columnsWithVisibilityTrigger,
        evaluators: columnData.evaluators,
        staticMetricColumns: columnData.staticMetricColumns,
        loadedColumnGroups: columnData.groups,
        ungroupedColumns: columnData.ungroupedColumns,
    }
}

export default usePreviewColumns
