import {useCallback, useMemo} from "react"

import {Button, Spin} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedTable from "@/oss/components/EnhancedUIs/Table"
import {SessionDrawer} from "@/oss/components/SharedDrawers/SessionDrawer"
import {useSessions} from "@/oss/state/newObservability/hooks/useSessions"
import {openSessionDrawerWithUrlAtom} from "@/oss/state/url/session"

import EmptySessions from "./assets/EmptySessions"
import {getSessionColumns, SessionRow} from "./assets/getSessionColumns"

const ObservabilityHeader = dynamic(() => import("../../components/ObservabilityHeader"), {
    ssr: false,
})

const SessionsTable: React.FC = () => {
    const {isLoading, sessionIds, fetchMoreSessions, hasMoreSessions, isFetchingMore} =
        useSessions()

    const openDrawer = useSetAtom(openSessionDrawerWithUrlAtom)

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

    return (
        <div className="flex flex-col gap-6">
            <ObservabilityHeader columns={columns} componentType="sessions" />

            {sessionIds.length === 0 && !isLoading ? (
                <EmptySessions />
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

                    {hasMoreSessions && (
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
                    )}
                </div>
            )}
            <SessionDrawer />
        </div>
    )
}

export default SessionsTable
