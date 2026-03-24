import {type Key, useCallback, useEffect, useMemo, useState} from "react"

import {Button, type TableProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    InfiniteVirtualTable,
    shouldIgnoreRowClick,
    type ColumnVisibilityState,
} from "@/oss/components/InfiniteVirtualTable"
import {deleteTraceModalAtom} from "@/oss/components/SharedDrawers/TraceDrawer/components/DeleteTraceModal/store/atom"
import {setTraceDrawerActiveSpanAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import {isNewUserAtom} from "@/oss/lib/onboarding"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {type KeyValuePair} from "@/oss/lib/Types"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"
import {
    annotationEvaluatorSlugsAtom,
    getAgData,
    useObservability,
} from "@/oss/state/newObservability"
import {
    DEFAULT_OBSERVABILITY_HIDDEN_COLUMNS,
    hasReceivedTracesAtom,
} from "@/oss/state/newObservability/atoms/controls"

import {
    getObservabilityColumns,
    type ObservabilityTraceRow,
} from "../../assets/getObservabilityColumns"
import {AUTO_REFRESH_INTERVAL} from "../../constants"

const ObservabilityHeader = dynamic(() => import("../ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("../EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(
    () => import("../../../../SharedDrawers/AddToTestsetDrawer/TestsetDrawer"),
    {
        ssr: false,
    },
)

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

const resolveTraceId = (record: TraceSpanNode) =>
    String(
        record.trace_id ||
            (record as any)?.invocationIds?.trace_id ||
            (record as any)?.node?.trace_id ||
            (record as any)?.root?.id ||
            (record as any)?.traceId ||
            (record as any)?.trace?.id ||
            record.span_id ||
            "",
    )

const ObservabilityTable = () => {
    const {
        traces,
        isLoading,
        fetchTraces,
        selectedTraceId,
        setSelectedTraceId,
        editColumns,
        setEditColumns,
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
        autoRefresh,
        fetchAnnotations,
    } = useObservability()
    const setTraceDrawerActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const setDeleteModalState = useSetAtom(deleteTraceModalAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const onboardingStorageUserId = useAtomValue(onboardingStorageUserIdAtom)
    const hasReceivedTraces = useAtomValue(hasReceivedTracesAtom)
    const setHasReceivedTraces = useSetAtom(hasReceivedTracesAtom)
    const annotationEvaluatorSlugs = useAtomValue(annotationEvaluatorSlugsAtom)

    const [traceParamValue, setTraceParam] = useQueryParamState("trace")
    const traceParam = Array.isArray(traceParamValue)
        ? (traceParamValue[0] ?? "")
        : ((traceParamValue as string | undefined) ?? "")

    const [spanParamValue, setSpanParam] = useQueryParamState("span")
    const spanParam = Array.isArray(spanParamValue)
        ? (spanParamValue[0] ?? "")
        : ((spanParamValue as string | undefined) ?? "")

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
    }, [activeTrace, selectedNode, setSelectedNode])

    const [refreshTrigger, setRefreshTrigger] = useState(0)

    const handleRefresh = useCallback(async () => {
        await Promise.all([fetchAnnotations(), fetchTraces()])
        setRefreshTrigger((prev) => prev + 1)
    }, [fetchAnnotations, fetchTraces])

    useEffect(() => {
        if (!autoRefresh) return

        const intervalId = setInterval(() => {
            handleRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)

        return () => clearInterval(intervalId)
    }, [autoRefresh, handleRefresh])

    const handleLoadMore = useCallback(() => {
        if (isFetchingMore || !hasMoreTraces) return

        fetchMoreTraces().catch((error) => console.error("Failed to fetch more traces", error))
    }, [fetchMoreTraces, hasMoreTraces, isFetchingMore])

    const showTableLoading = isLoading && traces.length === 0
    const isEmptyState = traces.length === 0 && !isLoading
    const showOnboarding = isNewUser && !hasReceivedTraces

    useEffect(() => {
        if (onboardingStorageUserId && traces.length > 0 && !hasReceivedTraces) {
            setHasReceivedTraces(true)
        }
    }, [onboardingStorageUserId, traces.length, hasReceivedTraces, setHasReceivedTraces])

    const buildTestsetTraceData = useCallback(
        (nodes: TraceSpanNode[]) =>
            nodes
                .map((node, idx) => ({
                    data: getAgData(node) as KeyValuePair,
                    key: node.span_id ?? "",
                    id: idx + 1,
                }))
                .filter((item) => item.key),
        [],
    )

    const handleAddTraceToTestset = useCallback(
        (record: ObservabilityTraceRow) => {
            const data = buildTestsetTraceData([record])
            if (data.length > 0) {
                setTestsetDrawerData(data)
            }
        },
        [buildTestsetTraceData, setTestsetDrawerData],
    )

    const openTraceRecord = useCallback(
        (record: TraceSpanNode) => {
            setSelectedNode(record.span_id ?? "")

            const targetTraceId = resolveTraceId(record)
            const targetSpanId = String(record.span_id || "")

            if (!targetTraceId) {
                console.warn("TraceDrawer: unable to determine trace id for record", record)
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
        [
            setSelectedNode,
            setSelectedTraceId,
            setSpanParam,
            setTraceDrawerActiveSpan,
            setTraceParam,
        ],
    )

    const handleDeleteTrace = useCallback(
        (record: ObservabilityTraceRow) => {
            const traceId = resolveTraceId(record)
            if (!traceId) return

            setDeleteModalState({
                isOpen: true,
                traceIds: [traceId],
                onClose: () => {
                    setSelectedRowKeys([])
                    handleRefresh()
                },
            })
        },
        [handleRefresh, setDeleteModalState, setSelectedRowKeys],
    )

    const traceRows = useMemo<ObservabilityTraceRow[]>(
        () =>
            traces.map((trace, index) => ({
                ...trace,
                key: String(trace.span_id || trace.key || trace.trace_id || `trace-${index}`),
                __isSkeleton: false,
            })),
        [traces],
    )

    const columns = useMemo(
        () =>
            getObservabilityColumns({
                evaluatorSlugs,
                onOpenTrace: openTraceRecord,
                onDeleteTrace: handleDeleteTrace,
                onAddToTestset: handleAddTraceToTestset,
            }),
        [evaluatorSlugs, handleAddTraceToTestset, handleDeleteTrace, openTraceRecord],
    )

    const handleColumnVisibilityStateChange = useCallback(
        (state: ColumnVisibilityState<ObservabilityTraceRow>) => {
            const nextHiddenKeys = state.hiddenKeys
                .map((key) => String(key))
                .filter((key) => key !== "actions")
            if (nextHiddenKeys.join("|") === editColumns.join("|")) return
            setEditColumns(nextHiddenKeys)
        },
        [editColumns, setEditColumns],
    )

    const rowSelection = useMemo(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys,
            onChange: (keys: Key[]) => {
                setSelectedRowKeys(keys)
            },
            columnWidth: 48,
            getCheckboxProps: (record: ObservabilityTraceRow) => ({
                "data-tour":
                    record.span_id === traceRows[0]?.span_id ? "trace-checkbox" : undefined,
            }),
        }),
        [selectedRowKeys, setSelectedRowKeys, traceRows],
    )

    const tableProps = useMemo<TableProps<ObservabilityTraceRow>>(
        () => ({
            loading: showTableLoading,
            bordered: true,
            sticky: {
                offsetHeader: 0,
                offsetScroll: 0,
            },
            tableLayout: "fixed",
            onRow: (record, index) => ({
                onClick: (event) => {
                    if (shouldIgnoreRowClick(event)) return
                    openTraceRecord(record)
                },
                style: {cursor: "pointer"},
                "data-tour": index === 0 ? "trace-row" : undefined,
            }),
        }),
        [openTraceRecord, showTableLoading],
    )

    return (
        <div className="flex flex-col gap-6">
            <ObservabilityHeader
                columns={columns}
                componentType="traces"
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
            />

            {isEmptyState ? (
                <EmptyObservability showOnboarding={showOnboarding} />
            ) : (
                <div className="flex flex-col gap-2">
                    <InfiniteVirtualTable<ObservabilityTraceRow>
                        columns={columns}
                        dataSource={traceRows}
                        rowKey={(record) => record.key}
                        rowSelection={rowSelection}
                        resizableColumns
                        scopeId="observability-traces-table"
                        tableClassName="[&_.ant-table-tbody_.ant-table-cell]:align-top"
                        tableProps={tableProps}
                        columnVisibility={{
                            storageKey: "observability-table-columns",
                            defaultHiddenKeys: [...DEFAULT_OBSERVABILITY_HIDDEN_COLUMNS],
                            onStateChange: handleColumnVisibilityStateChange,
                        }}
                    />

                    {hasMoreTraces ? (
                        <Button
                            onClick={handleLoadMore}
                            disabled={isFetchingMore}
                            type="text"
                            size="large"
                        >
                            {isFetchingMore ? "Loading…" : "Click here to load more"}
                        </Button>
                    ) : null}
                </div>
            )}

            <TestsetDrawer
                open={testsetDrawerData.length > 0}
                spanIds={testsetDrawerData.map((d) => d.key)}
                onClose={() => {
                    setTestsetDrawerData([])
                    setSelectedRowKeys([])
                }}
            />
        </div>
    )
}

export default ObservabilityTable
