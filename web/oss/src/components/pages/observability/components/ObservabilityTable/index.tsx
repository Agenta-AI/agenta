import {type Key, type ReactNode, useCallback, useEffect, useMemo, useState, useRef} from "react"

import {setTraceDrawerActiveSpanAtom} from "@agenta/observability/traceDrawer"
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
import {useAppNavigation, useQueryParamState} from "@/oss/state/appState"
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

    const {patchQuery} = useAppNavigation()
    // The trace id whose params the row click has already queued. The effect below also pushes
    // `selectedTraceId` into the URL, and it reads a `traceParam` that is still stale at that
    // point — so it fired a SECOND navigation ~50ms behind the click's, in the same tick. Next
    // cancels the first when the second arrives (`Router.replace` returned false), and the
    // survivor landed with only one of the two params. One writer per gesture.
    const requestedTraceRef = useRef<string | null>(null)

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
        // The URL has caught up with the row click — stop treating that selection as in flight.
        if (traceParam && requestedTraceRef.current === traceParam) requestedTraceRef.current = null
        if (traceParam && traceParam !== selectedTraceId) {
            setSelectedTraceId(traceParam)
            return
        }
        if (!traceParam && !selectedTraceId) {
            // A row click whose params have not landed in `traceParam` yet reads exactly like
            // "nothing is selected", and this branch then wiped `?span=` — 300ms after the click
            // put both params on the URL. The drawer opens off `?trace=`, so the clear closed it
            // again: click, flash, gone. Hold off while a selection is in flight.
            if (requestedTraceRef.current) return
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
        // Already queued by the row click, params and all — writing it again here is the
        // navigation that cancels that one.
        if (requestedTraceRef.current === selectedTraceId) return
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
            console.log("[trace-drawer] 1 row click", {
                span: record?.span_id,
                trace: (record as any)?.trace_id,
            })
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
            // ONE navigation for both params. They used to go as two back-to-back
            // `useQueryParamState` writes, and `requestNavigationAtom` is a single slot: the
            // second command replaced the first before the listener ran, and both
            // `Router.replace` calls built their query from a `Router.query` the other had not
            // committed yet. The pair raced, the survivor lost the other's key, and the drawer —
            // which opens off `?trace=` via `syncTraceStateFromUrl` — opened and closed again as
            // the param appeared and vanished.
            requestedTraceRef.current = targetTraceId
            console.log("[trace-drawer] 2 patchQuery", {trace: targetTraceId, span: targetSpanId})
            patchQuery({trace: targetTraceId, span: targetSpanId || undefined})
        },
        [setSelectedNode, traceTabs, setSelectedTraceId, setTraceDrawerActiveSpan, patchQuery],
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
