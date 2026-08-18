import {type Key, type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {openTraceDrawerAtom, setTraceDrawerActiveSpanAtom} from "@agenta/observability/traceDrawer"
import {AUTO_REFRESH_INTERVAL} from "@agenta/observability-ui"
import {
    getDefaultHiddenObservabilityColumnKeys,
    getObservabilityColumns,
    ObservabilityTracesTable,
    useEvaluatorSlugs,
    type ObservabilityTraceRow as TraceRow,
} from "@agenta/observability-ui"
import type {TableScopeConfig} from "@agenta/ui/table"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import {isNewUserAtom} from "@/oss/lib/onboarding"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {useQueryParamState} from "@/oss/state/appState"
import {useObservability} from "@/oss/state/observability"
import {hasReceivedTracesAtom} from "@/oss/state/observability"

const ObservabilityHeader = dynamic(() => import("../ObservabilityHeader"), {ssr: false})
const EmptyObservability = dynamic(() => import("../EmptyObservability"), {ssr: false})
const TestsetDrawer = dynamic(
    () => import("../../../../SharedDrawers/AddToTestsetDrawer/TestsetDrawer"),
    {
        ssr: false,
    },
)

const ObservabilityTable = () => {
    const store = useStore()
    const {
        traces,
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
        autoRefresh,
        fetchAnnotations,
        resetTracePages,
        limit,
        isRateLimited,
        rateLimitMessage,
    } = useObservability()
    const setTraceDrawerActiveSpan = useSetAtom(setTraceDrawerActiveSpanAtom)
    const openTraceDrawer = useSetAtom(openTraceDrawerAtom)
    const isNewUser = useAtomValue(isNewUserAtom)
    const onboardingStorageUserId = useAtomValue(onboardingStorageUserIdAtom)
    const hasReceivedTraces = useAtomValue(hasReceivedTracesAtom)
    const setHasReceivedTraces = useSetAtom(hasReceivedTracesAtom)

    const [traceParamValue, setTraceParam] = useQueryParamState("trace")
    const traceParam = Array.isArray(traceParamValue)
        ? (traceParamValue[0] ?? "")
        : ((traceParamValue as string | undefined) ?? "")

    const [spanParamValue, setSpanParam] = useQueryParamState("span")
    const spanParam = Array.isArray(spanParamValue)
        ? (spanParamValue[0] ?? "")
        : ((spanParamValue as string | undefined) ?? "")

    const [refreshTrigger, setRefreshTrigger] = useState(0)
    // One derivation, in the package, so /m gets the same columns.
    const evaluatorSlugs = useEvaluatorSlugs()

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
            // Open the drawer DIRECTLY. It used to open as a side effect of the URL write below:
            // `?trace=` → `syncTraceStateFromUrl` → `openTraceDrawerAtom`. That round trip is gone
            // (the params never survive the navigation), so the row click did nothing at all.
            // Every other opener in the app — the chat turn, the agent message, the session tree,
            // the generation result — already calls this atom; this table was the one that didn't.
            openTraceDrawer({traceId: targetTraceId, activeSpanId: targetSpanId || null})
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
            openTraceDrawer,
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
    const showOnboarding = isNewUser && !hasReceivedTraces

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

            {isRateLimited ? (
                <EmptyObservability rateLimited rateLimitMessage={rateLimitMessage} />
            ) : (
                // The empty state renders INSIDE the table rather than replacing it, so the
                // header and its controls stay put instead of vanishing with the rows.
                <ObservabilityTracesTable
                    tableScope={tableScope}
                    evaluatorSlugs={evaluatorSlugs}
                    resizableColumns
                    enableExport={false}
                    useSettingsDropdown={false}
                    store={store}
                    className="flex-1 min-h-0 [&_.avt-thead_tr:nth-child(2)]:hidden"
                    rowSelection={{
                        selectedRowKeys,
                        type: "checkbox",
                        ...rowSelection,
                    }}
                    tableProps={{
                        locale: {
                            emptyText: <EmptyObservability showOnboarding={showOnboarding} />,
                        },
                        loading: showTableLoading,
                        style: {cursor: "pointer"},
                        onRow: (record: TraceRow, index?: number) => ({
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
