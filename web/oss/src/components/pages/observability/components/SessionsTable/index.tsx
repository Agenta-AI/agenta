import {useCallback, useEffect, useMemo, useState} from "react"

import {Button, Spin} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {SessionDrawer} from "@/oss/components/SharedDrawers/SessionDrawer"
import {isNewUserAtom} from "@/oss/lib/onboarding"
import {onboardingStorageUserIdAtom} from "@/oss/lib/onboarding/atoms"
import {hasReceivedSessionsAtom} from "@/oss/state/newObservability/atoms/controls"
import {useSessions} from "@/oss/state/newObservability/hooks/useSessions"
import {openSessionDrawerWithUrlAtom} from "@/oss/state/url/session"

import {AUTO_REFRESH_INTERVAL} from "../../constants"

import EmptySessions from "./assets/EmptySessions"
import {getSessionColumns, SessionRow} from "./assets/getSessionColumns"

const ObservabilityHeader = dynamic(() => import("../../components/ObservabilityHeader"), {
    ssr: false,
})

/**
 * Next iteration plan:
 * - Add infinite scroll for spans query
 * - Replace EnhancedTable with InfiniteVirtualTable
 * - For Session drawer add infinite scroll for spans
 */

const SessionsTable: React.FC = () => {
    const {
        isLoading,
        sessionIds,
        sessionCount,
        fetchMoreSessions,
        hasMoreSessions,
        isFetchingMore,
        refetchSessions,
        refetchSessionSpans,
        realtimeMode,
        setRealtimeMode,
        autoRefresh,
        setAutoRefresh,
    } = useSessions()

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

    const handleLoadMore = useCallback(() => {
        if (isFetchingMore || !hasMoreSessions) return
        fetchMoreSessions().catch((error) => console.error("Failed to fetch more sessions", error))
    }, [fetchMoreSessions, hasMoreSessions, isFetchingMore])

    const columns = useMemo(() => getSessionColumns(), [])

    const data: SessionRow[] = useMemo(
        () =>
            sessionIds.map((id) => ({
                key: id,
                session_id: id,
            })),
        [sessionIds],
    )

    const loadingFirstPage = isLoading && sessionIds.length === 0

    const handleRefresh = useCallback(async () => {
        await Promise.all([refetchSessions(), refetchSessionSpans()])
        setRefreshTrigger((prev) => prev + 1)
    }, [refetchSessions, refetchSessionSpans])

    // Auto-refresh logic: refresh every 15 seconds when enabled
    useEffect(() => {
        if (!autoRefresh) return

        const intervalId = setInterval(() => {
            handleRefresh().catch((error) => console.error("Auto-refresh failed", error))
        }, AUTO_REFRESH_INTERVAL)

        return () => clearInterval(intervalId)
    }, [autoRefresh, handleRefresh])

    return (
        <div className="flex flex-col gap-6">
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

            {sessionIds.length === 0 && !isLoading ? (
                <EmptySessions showOnboarding={showOnboarding} />
            ) : (
                <div className="flex flex-col gap-2">
                    <EnhancedTable<SessionRow>
                        uniqueKey="observability-sessions-table"
                        rowKey="session_id"
                        loading={loadingFirstPage}
                        columns={columns}
                        dataSource={data}
                        onRow={(record) => ({
                            onClick: () => openDrawer({sessionId: record.session_id}),
                            style: {cursor: "pointer"},
                        })}
                        pagination={false}
                    />

                    {/* Hide load more button in realtime mode (latest activity shows fixed LIMIT items) */}
                    {hasMoreSessions && !loadingFirstPage && !realtimeMode ? (
                        <div className="flex justify-center py-2">
                            <Button
                                onClick={handleLoadMore}
                                disabled={isFetchingMore}
                                type="text"
                                size="large"
                            >
                                {isFetchingMore ? (
                                    <span>
                                        <Spin size="small" className="mr-2" />
                                        Loading…
                                    </span>
                                ) : (
                                    "Click here to load more"
                                )}
                            </Button>
                        </div>
                    ) : null}
                </div>
            )}
            <SessionDrawer />
        </div>
    )
}

export default SessionsTable
