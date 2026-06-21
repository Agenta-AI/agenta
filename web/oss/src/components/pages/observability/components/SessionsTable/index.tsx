import {useCallback, useEffect, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell} from "@agenta/ui/table"
import type {TableFeaturePagination, TableScopeConfig} from "@agenta/ui/table"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import {SessionDrawer} from "@/oss/components/SharedDrawers/SessionDrawer"
import {isNewUserAtom} from "@/oss/lib/onboarding"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {SESSIONS_PAGE_SIZE} from "@/oss/state/newObservability"
import {hasReceivedSessionsAtom} from "@/oss/state/newObservability/atoms/controls"
import {useSessions} from "@/oss/state/newObservability/hooks/useSessions"
import {openSessionDrawerWithUrlAtom} from "@/oss/state/url/session"

import {AUTO_REFRESH_INTERVAL} from "../../constants"

import EmptySessions from "./assets/EmptySessions"
import {getSessionColumns, SessionRow} from "./assets/getSessionColumns"

const ObservabilityHeader = dynamic(() => import("../../components/ObservabilityHeader"), {
    ssr: false,
})

const tableScope: TableScopeConfig = {
    scopeId: "sessions",
    pageSize: SESSIONS_PAGE_SIZE,
    columnVisibilityStorageKey: "observability-sessions-table-columns",
}

/**
 * Next iteration plan:
 * - Add infinite scroll for spans query
 * - For Session drawer add infinite scroll for spans
 */

const SessionsTable: React.FC = () => {
    const {
        isLoading,
        sessionIds,
        sessionCount,
        realtimeMode,
        setRealtimeMode,
        autoRefresh,
        setAutoRefresh,
        fetchMoreSessions,
        hasMoreSessions,
        isFetchingMore,
        resetSessionPages,
    } = useSessions()

    // The per-session cells (Traces count, First input, metrics, …) read their
    // data from page-level atoms keyed by session id (e.g. `sessionsSpansAtom`).
    // Without this, the table mounts its rows inside an isolated Jotai store
    // (`useIsolatedStore` when no `store` is passed), where those atoms are empty
    // — so every cell renders 0/"-" even though the data is loaded in the page
    // store. Sharing the page store lets the cells resolve the real data.
    const store = useStore()

    const isNewUser = useAtomValue(isNewUserAtom)
    const onboardingStorageUserId = useAtomValue(onboardingStorageUserIdAtom)
    const openDrawer = useSetAtom(openSessionDrawerWithUrlAtom)
    const hasReceivedSessions = useAtomValue(hasReceivedSessionsAtom)
    const setHasReceivedSessions = useSetAtom(hasReceivedSessionsAtom)
    const [refreshTrigger, setRefreshTrigger] = useState(0)
    const showOnboarding = isNewUser && !hasReceivedSessions

    useEffect(() => {
        if (onboardingStorageUserId && sessionCount > 0 && !hasReceivedSessions) {
            setHasReceivedSessions(true)
        }
    }, [onboardingStorageUserId, sessionCount, hasReceivedSessions, setHasReceivedSessions])

    const columns = useMemo(() => getSessionColumns(), [])

    const data: SessionRow[] = useMemo(
        () =>
            sessionIds.map((id) => ({
                key: id,
                session_id: id,
            })),
        [sessionIds],
    )

    const handleRefresh = useCallback(async () => {
        // Reset to page 1 so only one API call per query on refresh.
        resetSessionPages()
        setRefreshTrigger((prev) => prev + 1)
    }, [resetSessionPages])

    // Auto-refresh logic: refresh every 15 seconds when enabled
    useEffect(() => {
        if (!autoRefresh) return

        const intervalId = setInterval(() => {
            handleRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)

        return () => clearInterval(intervalId)
    }, [autoRefresh, handleRefresh])

    // Build pagination object expected by InfiniteVirtualTableFeatureShell
    const pagination: TableFeaturePagination<SessionRow> = useMemo(
        () => ({
            rows: data,
            loadNextPage: () => fetchMoreSessions(),
            resetPages: resetSessionPages,
            paginationInfo: {
                hasMore: hasMoreSessions,
                nextCursor: null,
                nextOffset: null,
                isFetching: isFetchingMore,
                totalCount: sessionCount,
            },
        }),
        [data, fetchMoreSessions, hasMoreSessions, isFetchingMore, sessionCount, resetSessionPages],
    )

    const isEmptyState = sessionIds.length === 0 && !isLoading

    return (
        <div className="flex flex-col h-full gap-2 min-h-0">
            <ObservabilityHeader
                columns={columns}
                componentType="sessions"
                isLoading={isLoading}
                onRefresh={handleRefresh}
                realtimeMode={realtimeMode}
                setRealtimeMode={setRealtimeMode}
                autoRefresh={autoRefresh}
                setAutoRefresh={setAutoRefresh}
                refreshTrigger={refreshTrigger}
            />

            {isEmptyState ? (
                <EmptySessions showOnboarding={showOnboarding} />
            ) : (
                <InfiniteVirtualTableFeatureShell<SessionRow>
                    store={store}
                    tableScope={tableScope}
                    columns={columns}
                    rowKey="session_id"
                    pagination={pagination}
                    resizableColumns
                    enableExport={false}
                    useSettingsDropdown={false}
                    className="[&_.ant-table-tbody_.ant-table-cell]:align-top"
                    tableProps={{
                        bordered: true,
                        loading: isLoading && sessionIds.length === 0,
                        onRow: (record) => ({
                            onClick: () => openDrawer({sessionId: record.session_id}),
                            style: {cursor: "pointer"},
                        }),
                    }}
                />
            )}
            <SessionDrawer />
        </div>
    )
}

export default SessionsTable
