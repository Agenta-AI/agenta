import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Table, TableColumnType} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {setTraceDrawerActiveSpanAtom} from "@/oss/components/Playground/Components/Drawers/TraceDrawer/store/traceDrawerStore"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"
import {annotationEvaluatorSlugsAtom, useObservability} from "@/oss/state/newObservability"

import {filterColumns} from "../../Filters/EditColumns/assets/helper"
import ResizableTitle from "../../ResizableTitle"

import {getObservabilityColumns} from "./assets/getObservabilityColumns"
import PageLayout from "../../PageLayout/PageLayout"

const ObservabilityHeader = dynamic(() => import("./assets/ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("./assets/EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(() => import("./drawer/TestsetDrawer/TestsetDrawer"), {ssr: false})

const collectEvaluatorSlugsFromTraces = (traces: TraceSpanNode[]) => {
    const slugs = new Set<string>()

    const visit = (node?: TraceSpanNode) => {
        if (!node) return

        const metrics = (node as TraceSpanNode & {aggregatedEvaluatorMetrics?: Record<string, any>})
            ?.aggregatedEvaluatorMetrics
        if (metrics && typeof metrics === "object") {
            Object.keys(metrics).forEach((slug) => {
                if (slug) {
                    slugs.add(slug)
                }
            })
        }

        const children = (node as TraceSpanNode & {children?: TraceSpanNode[]})?.children
        if (Array.isArray(children)) {
            children.forEach((child) => visit(child as TraceSpanNode))
        }
    }

    traces.forEach((trace) => visit(trace))

    return Array.from(slugs)
}

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

    const annotationEvaluatorSlugs = useAtomValue(annotationEvaluatorSlugsAtom)

    const traceEvaluatorSlugs = useMemo(() => collectEvaluatorSlugsFromTraces(traces), [traces])

    const evaluatorSlugs = useMemo(() => {
        if (!annotationEvaluatorSlugs.length && !traceEvaluatorSlugs.length) return []

        const present = new Set(traceEvaluatorSlugs)
        const ordered: string[] = []

        annotationEvaluatorSlugs.forEach((slug) => {
            if (present.has(slug)) {
                ordered.push(slug)
                present.delete(slug)
            }
        })

        const remaining = Array.from(present).sort()
        return [...ordered, ...remaining]
    }, [annotationEvaluatorSlugs, traceEvaluatorSlugs])

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
            return
        }
        if (!traceParam && !selectedTraceId) {
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
            onHeaderCell: (column: TableColumnType<TraceSpanNode[]>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns, editColumns])

    return (
        <PageLayout title={"Observability"}>
            <div className="flex flex-col gap-2">
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

                                const targetTraceId = String(
                                    record.trace_id ||
                                        (record as any)?.invocationIds?.trace_id ||
                                        (record as any)?.node?.trace_id ||
                                        (record as any)?.root?.id ||
                                        (record as any)?.traceId ||
                                        (record as any)?.trace?.id ||
                                        record.span_id ||
                                        "",
                                )

                                const targetSpanId = isSpanView
                                    ? String(record.span_id || "")
                                    : String(record.span_id || "")

                                if (!targetTraceId) {
                                    console.warn(
                                        "TraceDrawer: unable to determine trace id for record",
                                        record,
                                    )
                                    return
                                }

                                setSelectedTraceId(targetTraceId)
                                setTraceDrawerActiveSpan(targetSpanId || null)
                                setTraceParam(targetTraceId)
                                if (targetSpanId) {
                                    setSpanParam(targetSpanId)
                                } else {
                                    setSpanParam(undefined)
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
        </PageLayout>
    )
}

export default ObservabilityDashboard
