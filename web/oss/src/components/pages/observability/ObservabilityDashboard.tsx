import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Table, TableColumnType, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {setTraceDrawerActiveSpanAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {TracesWithAnnotations} from "@/oss/services/observability/types"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"
import {useObservability} from "@/oss/state/newObservability"

import {filterColumns} from "../../Filters/EditColumns/assets/helper"
import ResizableTitle from "../../ResizableTitle"

import {getObservabilityColumns} from "./assets/getObservabilityColumns"

const ObservabilityHeader = dynamic(() => import("./assets/ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("./assets/EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(() => import("./drawer/TestsetDrawer/TestsetDrawer"), {ssr: false})

const ObservabilityDashboard = () => {
    const {
        traces,
        isLoading,
        traceTabs,
        fetchTraces,
        selectedTraceId,
        setSelectedTraceId,
        editColumns,
        selectedRowKeys,
        setSelectedRowKeys,
        testsetDrawerData,
        setTestsetDrawerData,
        selectedNode,
        setSelectedNode,
        activeTrace,
        fetchMoreTraces,
        hasMoreTraces,
        isFetchingMore,
    } = useObservability()
    const setTraceDrawerActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)

    const [traceParamValue, setTraceParam] = useQueryParamState("trace")
    const traceParam = Array.isArray(traceParamValue)
        ? (traceParamValue[0] ?? "")
        : ((traceParamValue as string | undefined) ?? "")

    const [spanParamValue, setSpanParam] = useQueryParamState("span")
    const spanParam = Array.isArray(spanParamValue)
        ? (spanParamValue[0] ?? "")
        : ((spanParamValue as string | undefined) ?? "")

    const evaluatorSlugs = useMemo(() => {
        const slugs = new Set<string>()

        const visit = (node?: TraceSpanNode) => {
            if (!node) return

            const metrics = (node as any)?.aggregatedEvaluatorMetrics as
                | Record<string, unknown>
                | undefined

            if (metrics) {
                Object.keys(metrics).forEach((slug) => {
                    if (slug) {
                        slugs.add(slug)
                    }
                })
            }

            node.children?.forEach((child) => visit(child as TraceSpanNode))
        }

        traces.forEach((trace) => visit(trace as TraceSpanNode))

        return Array.from(slugs)
    }, [traces])

    const initialColumns = useMemo(
        () => getObservabilityColumns({evaluatorSlugs}),
        [evaluatorSlugs],
    )
    const [columns, setColumns] = useState<ColumnsType<TraceSpanNode>>(initialColumns)

    useEffect(() => {
        setColumns(initialColumns)
    }, [initialColumns])

    useEffect(() => {
        if (traceParam && traceParam !== selectedTraceId) {
            setSelectedTraceId(traceParam)
        }
        if (!traceParam) {
            setTraceDrawerActiveSpan(null)
            setSpanParam(undefined, {shallow: true})
        }
    }, [traceParam, selectedTraceId, setSelectedTraceId, setTraceDrawerActiveSpan, setSpanParam])

    useEffect(() => {
        if (spanParam) {
            setTraceDrawerActiveSpan(spanParam)
            setSelectedNode(spanParam)
        }
    }, [spanParam, setTraceDrawerActiveSpan, setSelectedNode])

    useEffect(() => {
        if (!selectedTraceId || selectedTraceId === traceParam) return
        setTraceParam(selectedTraceId, {shallow: true})
    }, [selectedTraceId, traceParam, setTraceParam])

    useEffect(() => {
        if (!selectedNode) {
            setSelectedNode(activeTrace?.span_id || "")
        }
    }, [activeTrace, selectedNode])

    useEffect(() => {
        const interval = setInterval(fetchTraces, 300000)

        return () => clearInterval(interval)
    }, [])

    const handleLoadMore = useCallback(() => {
        if (isFetchingMore || !hasMoreTraces) return

        fetchMoreTraces().catch((error) => console.error("Failed to fetch more traces", error))
    }, [fetchMoreTraces, hasMoreTraces, isFetchingMore])

    const rowSelection = {
        onChange: (keys: React.Key[]) => {
            setSelectedRowKeys(keys)
        },
    }

    const showTableLoading = isLoading && traces.length === 0

    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumns((cols) => {
                return cols.map((col) => ({
                    ...col,
                    width: col.key === key ? size.width : col.width,
                }))
            })
        }

    const mergedColumns = useMemo(() => {
        return filterColumns(columns, editColumns).map((col) => ({
            ...col,
            width: col.width || 200,
            onHeaderCell: (column: TableColumnType<TracesWithAnnotations[]>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns, editColumns])

    return (
        <div className="flex flex-col gap-6">
            <Typography.Text className="text-[16px] font-medium">Observability</Typography.Text>

            <ObservabilityHeader columns={columns} />

            <div className="flex flex-col gap-2">
                <Table
                    rowSelection={{
                        type: "checkbox",
                        columnWidth: 48,
                        selectedRowKeys,
                        ...rowSelection,
                    }}
                    loading={showTableLoading}
                    columns={mergedColumns as TableColumnType<TraceSpanNode>[]}
                    dataSource={traces}
                    bordered
                    style={{cursor: "pointer"}}
                    sticky={{
                        offsetHeader: 0,
                        offsetScroll: 0,
                    }}
                    onRow={(record) => ({
                        onClick: () => {
                            setSelectedNode(record.span_id)
                            const isSpanView = traceTabs === "span"

                            const targetTraceId =
                                record.trace_id ||
                                (record as any)?.invocationIds?.trace_id ||
                                (record as any)?.node?.trace_id ||
                                (record as any)?.root?.id ||
                                (record as any)?.traceId ||
                                (record as any)?.trace?.id ||
                                record.span_id ||
                                null

                            const targetSpanId = isSpanView
                                ? record.span_id || null
                                : record.span_id || null

                            if (!targetTraceId) {
                                console.warn(
                                    "TraceDrawer: unable to determine trace id for record",
                                    record,
                                )
                                return
                            }

                            setSelectedTraceId(targetTraceId)
                            setTraceDrawerActiveSpan(targetSpanId)
                            setTraceParam(targetTraceId, {shallow: true})
                            if (targetSpanId) {
                                setSpanParam(targetSpanId, {shallow: true})
                            } else {
                                setSpanParam(undefined, {shallow: true})
                            }
                        },
                    })}
                    components={{
                        header: {
                            cell: ResizableTitle,
                        },
                    }}
                    pagination={false}
                    scroll={{x: "max-content"}}
                    locale={{
                        emptyText: <EmptyObservability />,
                    }}
                />
                {hasMoreTraces && (
                    <Button
                        onClick={handleLoadMore}
                        disabled={isFetchingMore}
                        type="text"
                        size="large"
                    >
                        {isFetchingMore ? "Loading…" : "Click here to load more"}
                    </Button>
                )}
            </div>

            <TestsetDrawer
                open={testsetDrawerData.length > 0}
                data={testsetDrawerData}
                onClose={() => {
                    setTestsetDrawerData([])
                    setSelectedRowKeys([])
                }}
            />
        </div>
    )
}

export default ObservabilityDashboard
