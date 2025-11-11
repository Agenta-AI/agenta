import {memo, useMemo, useCallback, useState, type Key, useRef, RefObject} from "react"

import {Table} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useRouter} from "next/router"
import {Resizable} from "react-resizable"
import {useResizeObserver} from "usehooks-ts"

import {EvaluationType} from "@/oss/lib/enums"
import useEvaluationRunMetrics from "@/oss/lib/hooks/useEvaluationRunMetrics"
import useEvaluations from "@/oss/lib/hooks/useEvaluations"
import useRunMetricsMap from "@/oss/lib/hooks/useRunMetricsMap"

import SingleModelEvaluationHeader from "./assets/SingleModelEvaluationHeader"
import {useStyles} from "./assets/styles"
import {getColumns} from "./assets/utils"
import {EvaluationRow} from "./types"

import "react-resizable/css/styles.css"
import "@/oss/assets/custom-resize-handle.css"

export const ResizableTitle = (props: any) => {
    const {onResize, width, ...restProps} = props
    if (!width) {
        return <th {...restProps} />
    }
    // Debug: log when ResizableTitle renders and what props it gets
    return (
        <Resizable
            width={width}
            height={0}
            handle={
                <span
                    className="react-resizable-handle custom-resize-handle"
                    onClick={(e) => {
                        e.stopPropagation()
                        console.log("[ResizableTitle] Handle clicked", {width, ...restProps})
                    }}
                />
            }
            onResize={(...args) => {
                console.log("[ResizableTitle] onResize triggered", ...args)
                if (onResize) onResize(...args)
            }}
            draggableOpts={{enableUserSelectHack: false}}
        >
            <th
                {...restProps}
                style={{
                    ...restProps.style,
                    paddingRight: 8,
                    minWidth: 80,
                    width: width || 160,
                    // whiteSpace intentionally omitted so header text can wrap
                }}
            >
                <div style={{position: "relative", width: "100%", height: "100%"}}>
                    {restProps.children}
                    {/* The handle will be absolutely positioned by CSS */}
                </div>
            </th>
        </Resizable>
    )
}

const SingleModelEvaluation = ({viewType}: {viewType: "evaluation" | "overview"}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string

    const [selectedEvalRecord, setSelectedEvalRecord] = useState<EvaluationRow>()
    const [isDeleteEvalModalOpen, setIsDeleteEvalModalOpen] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])

    const {mergedEvaluations, isLoadingPreview, isLoadingLegacy} = useEvaluations({
        withPreview: true,
        types: [EvaluationType.single_model_test],
    })

    const runIds = useMemo(
        () => mergedEvaluations.map((e) => ("id" in e ? e.id : e.key)),
        [mergedEvaluations],
    )
    const {data: runMetricsMap} = useRunMetricsMap(runIds)
    const {swrData} = useEvaluationRunMetrics(runIds)

    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
    const toggleGroup = useCallback((key: string) => {
        setCollapsedGroups((prev) => ({...prev, [key]: !prev[key]}))
    }, [])

    const rowSelection = useMemo(() => {
        return {
            onChange: (selectedRowKeys: Key[]) => {
                setSelectedRowKeys(selectedRowKeys)
            },
        }
    }, [])

    const handleNavigation = useCallback(
        (revisionId: string) => {
            router.push({
                pathname: `/apps/${appId}/playground`,
                query: {
                    revisions: JSON.stringify([revisionId]),
                },
            })
        },
        [router, appId],
    )

    // --- Robust resizable grouped columns: width map by key ---
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})

    // New handleResize: update width by column key
    const handleResize = useCallback(
        (colKey: string) =>
            (e: any, {size}: any) => {
                setColumnWidths((widths) => ({
                    ...widths,
                    [colKey]: size.width,
                }))
            },
        [],
    )

    // Utility to recursively make columns resizable using width map and column keys
    const makeColumnsResizable = useCallback(
        (cols: any, widths: any, handleResize: any) => {
            return cols.map((col: any) => {
                // Ensure every column has a unique key
                const colKey =
                    col.key || col.dataIndex || col.title || Math.random().toString(36).slice(2)
                if (col.children && col.children.length > 0) {
                    // Group column: recurse, but do not add onResize
                    return {
                        ...col,
                        key: colKey,
                        width: widths[colKey] || col.width || 240,
                        minWidth: col.minWidth || 120,
                        onHeaderCell: () => ({
                            width: widths[colKey] || col.width || 240,
                            minWidth: col.minWidth || 120,
                            style: {textAlign: "center"},
                        }),
                        children: makeColumnsResizable(col.children, widths, handleResize),
                    }
                } else {
                    // Leaf column: make resizable
                    return {
                        ...col,
                        key: colKey,
                        width: widths[colKey] || Math.max(col.width || 160, 80),
                        onHeaderCell: () => ({
                            width: widths[colKey] || Math.max(col.width ?? 160, 80),
                            minWidth: 80,
                            onResize: handleResize(colKey),
                        }),
                    }
                }
            })
        },
        [columnWidths, handleResize],
    )

    const columns: ColumnsType<EvaluationRow> = useMemo(() => {
        const baseCols = getColumns(
            mergedEvaluations,
            router,
            handleNavigation,
            setSelectedEvalRecord,
            setIsDeleteEvalModalOpen,
            runMetricsMap,
            collapsedGroups,
            toggleGroup,
            classes,
        )
        // Always create resizable columns from widths map
        return makeColumnsResizable(baseCols, columnWidths, handleResize)
    }, [
        mergedEvaluations,
        router,
        handleNavigation,
        setSelectedEvalRecord,
        setIsDeleteEvalModalOpen,
        runMetricsMap,
        collapsedGroups,
        toggleGroup,
        columnWidths,
    ])

    const containerRef = useRef<HTMLDivElement | null>(null)
    const {height} = useResizeObserver({
        ref: containerRef as RefObject<HTMLElement>,
    })

    const dataSource = useMemo(() => {
        return viewType === "overview" ? mergedEvaluations.slice(0, 5) : mergedEvaluations
    }, [viewType, mergedEvaluations])

    return (
        <div
            className={clsx(classes.container, "grow flex flex-col min-h-0 overflow-hidden", {
                "human-eval": viewType !== "overview",
            })}
        >
            <SingleModelEvaluationHeader
                viewType={viewType}
                selectedRowKeys={selectedRowKeys}
                mergedEvaluations={mergedEvaluations}
                runMetricsMap={runMetricsMap}
                setSelectedRowKeys={setSelectedRowKeys}
                isDeleteEvalModalOpen={isDeleteEvalModalOpen}
                setIsDeleteEvalModalOpen={setIsDeleteEvalModalOpen}
                selectedEvalRecord={selectedEvalRecord}
            />

            <div className="relative w-full h-full overflow-auto">
                <Table
                    rowSelection={
                        viewType === "evaluation"
                            ? {
                                  type: "checkbox",
                                  columnWidth: 48,
                                  selectedRowKeys,
                                  ...rowSelection,
                              }
                            : undefined
                    }
                    components={{
                        header: {
                            cell: ResizableTitle,
                        },
                    }}
                    rowKey={(record) => {
                        return record.id || record.key
                    }}
                    className={clsx("ph-no-capture", "grow min-h-0", "eval-runs-table")}
                    columns={columns}
                    dataSource={dataSource}
                    scroll={{x: "max-content", y: height}}
                    sticky
                    tableLayout="fixed"
                    bordered
                    pagination={false}
                    loading={isLoadingPreview || isLoadingLegacy}
                    onRow={(record) => ({
                        style: {cursor: "pointer"},
                        onClick: () =>
                            router.push(
                                `/apps/${appId}/evaluations/single_model_test/${"id" in record ? record.id : record.key}`,
                            ),
                    })}
                />
            </div>
            <div className="h-6 w-full" />
        </div>
    )
}

export default memo(SingleModelEvaluation)
