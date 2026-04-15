import {type Key, type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell} from "@agenta/ui/table"
import type {TableFeaturePagination, TableScopeConfig} from "@agenta/ui/table"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import {setTraceDrawerActiveSpanAtom} from "@/oss/components/SharedDrawers/TraceDrawer/store/traceDrawerStore"
import {isNewUserAtom} from "@/oss/lib/onboarding"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"
import {annotationEvaluatorSlugsAtom, useObservability} from "@/oss/state/newObservability"
import {hasReceivedTracesAtom} from "@/oss/state/newObservability/atoms/controls"

import {
    getDefaultHiddenObservabilityColumnKeys,
    getObservabilityColumns,
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

const ObservabilityTable = () => {
    const store = useStore()
    const {
        traces,
        traceCount,
        isLoading,
        traceTabs,
        selectedTraceId,
        setSelectedTraceId,
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
        resetTracePages,
        limit,
    } = useObservability()
    const setTraceDrawerActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
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

    const [refreshTrigger, setRefreshTrigger] = useState(0)
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

    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs}), [evaluatorSlugs])
    const defaultHiddenColumnKeys = useMemo(
        () => getDefaultHiddenObservabilityColumnKeys({evaluatorSlugs}),
        [evaluatorSlugs],
    )

    const tableScope: TableScopeConfig = useMemo(
        () => ({
            scopeId: "observability-traces-table",
            pageSize: limit,
            columnVisibilityStorageKey: "observability-table-columns",
            columnVisibilityDefaults: defaultHiddenColumnKeys,
        }),
        [defaultHiddenColumnKeys, limit],
    )

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

    const handleRefresh = useCallback(async () => {
        // Reset to page 1 first so only one API call is made on refresh
        // instead of refetching every page the user has scrolled through.
        resetTracePages()
        await fetchAnnotations()
        setRefreshTrigger((prev) => prev + 1)
    }, [fetchAnnotations, resetTracePages])

    useEffect(() => {
        if (!autoRefresh) return

        const intervalId = setInterval(() => {
            handleRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)

        return () => clearInterval(intervalId)
    }, [autoRefresh, handleRefresh])

    const handleTraceRowClick = useCallback(
        (record: TraceSpanNode) => {
            setSelectedNode(record.span_id)

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

            const targetSpanId =
                traceTabs === "span" ? String(record.span_id || "") : String(record.span_id || "")

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
            traceTabs,
            setSelectedTraceId,
            setTraceDrawerActiveSpan,
            setTraceParam,
            setSpanParam,
        ],
    )

    const rowSelection = useMemo(
        () => ({
            onChange: (keys: Key[]) => {
                setSelectedRowKeys(keys)
            },
            columnWidth: 48,
            renderCell: (
                _checked: boolean,
                record: TraceSpanNode,
                _index: number,
                originNode: ReactNode,
            ) => (
                <span
                    data-tour={record.span_id === traces[0]?.span_id ? "trace-checkbox" : undefined}
                >
                    {originNode}
                </span>
            ),
        }),
        [setSelectedRowKeys, traces],
    )

    const showTableLoading = isLoading && traces.length === 0
    const isEmptyState = traces.length === 0 && !isLoading
    const showOnboarding = isNewUser && !hasReceivedTraces

    // Build pagination object expected by InfiniteVirtualTableFeatureShell
    const pagination: TableFeaturePagination<TraceSpanNode> = useMemo(
        () => ({
            rows: traces,
            loadNextPage: () => fetchMoreTraces(),
            resetPages: resetTracePages,
            paginationInfo: {
                hasMore: hasMoreTraces,
                nextCursor: null,
                nextOffset: null,
                isFetching: isFetchingMore,
                totalCount: traceCount,
            },
        }),
        [traces, fetchMoreTraces, resetTracePages, hasMoreTraces, isFetchingMore, traceCount],
    )

    useEffect(() => {
        if (onboardingStorageUserId && traces.length > 0 && !hasReceivedTraces) {
            setHasReceivedTraces(true)
        }
    }, [onboardingStorageUserId, traces.length, hasReceivedTraces, setHasReceivedTraces])

    return (
        <div className="flex flex-col h-full min-h-0">
            <ObservabilityHeader
                columns={columns}
                componentType="traces"
                onRefresh={handleRefresh}
                refreshTrigger={refreshTrigger}
            />

            {isEmptyState ? (
                <EmptyObservability showOnboarding={showOnboarding} />
            ) : (
                <InfiniteVirtualTableFeatureShell
                    tableScope={tableScope}
                    columns={columns}
                    rowKey={(record) => record.span_id || record.key}
                    pagination={pagination}
                    resizableColumns
                    enableExport={false}
                    useSettingsDropdown={false}
                    store={store}
                    className="flex-1 min-h-0 [&_.ant-table-thead_tr:nth-child(2)]:hidden"
                    rowSelection={{
                        selectedRowKeys,
                        type: "checkbox",
                        ...rowSelection,
                    }}
                    tableProps={{
                        bordered: true,
                        loading: showTableLoading,
                        sticky: true,
                        style: {cursor: "pointer"},
                        onRow: (record, index) => ({
                            onClick: () => handleTraceRowClick(record),
                            "data-tour": index === 0 ? "trace-row" : undefined,
                        }),
                    }}
                />
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
