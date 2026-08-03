import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {PageLayout} from "@agenta/ui"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {projectIdAtom} from "@/oss/state/project"

import SessionFiltersBar from "./components/SessionFiltersBar"
import SessionRow from "./components/SessionRow"
import {
    resetSessionFiltersAtom,
    sessionAgentFilterAtom,
    sessionFiltersActiveAtom,
    sessionSearchAtom,
    sessionShowArchivedAtom,
    sessionStatusFilterAtom,
} from "./state/filters"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "./state/pins"
import {
    pendingCountBySession,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "./state/useSessionList"
import {SessionListEmpty, SessionListError, SessionListSkeleton} from "./states/SessionListStates"

/**
 * The project-wide session list — sessions are the unit of work, so this is where they get
 * organised. Pins render as their own group, fetched by id, and are excluded from the main list so
 * nothing appears twice; both queries are server-ordered, so there is only ever one ordering.
 */
const SessionsPage = () => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const search = useAtomValue(sessionSearchAtom)
    const agentId = useAtomValue(sessionAgentFilterAtom)
    const status = useAtomValue(sessionStatusFilterAtom)
    const includeArchived = useAtomValue(sessionShowArchivedAtom)
    const filtersActive = useAtomValue(sessionFiltersActiveAtom)
    const resetFilters = useSetAtom(resetSessionFiltersAtom)
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingCountBySession(interactions.data),
        [interactions.data],
    )
    const waitingIds = useMemo(
        () => (pendingBySession ? [...pendingBySession.keys()] : undefined),
        [pendingBySession],
    )

    const shared = {search, agentId, status, includeArchived, waitingSessionIds: waitingIds}
    const pinnedQuery = useSessionList({
        ...shared,
        sessionIds: pinnedIds,
        enabled: pinnedIds.length > 0,
    })
    const listQuery = useSessionList({...shared, excludeSessionIds: pinnedIds})

    const pinnedRows = rowsFromPages(pinnedQuery.data?.pages)
    const rows = rowsFromPages(listQuery.data?.pages)

    const handleOpen = useCallback(
        (row: SessionStream) => {
            const target = sessionOpenTarget(row)
            if (target) openSession(target)
        },
        [openSession],
    )

    const targetOf = useCallback(
        (row: SessionStream): SessionActionTarget => ({
            sessionId: row.session_id,
            appId: sessionOpenTarget(row)?.appId ?? null,
            name: row.name,
            archived: Boolean(row.archived_at),
        }),
        [],
    )

    const actions = {
        onOpen: handleOpen,
        onTogglePin: togglePin,
        onRename: (row: SessionStream) => sessionActions.rename(targetOf(row)),
        onArchive: (row: SessionStream) => void sessionActions.setArchived(targetOf(row)),
        onDelete: (row: SessionStream) => sessionActions.remove(targetOf(row)),
    }

    const renderRow = (row: SessionStream, pinned: boolean) => (
        <SessionRow
            key={row.session_id}
            row={row}
            pinned={pinned}
            pendingCount={pendingBySession?.get(row.session_id)}
            menuItems={sessionActions.menuItems}
            {...actions}
        />
    )

    const isLoading = listQuery.isPending || (pinnedIds.length > 0 && pinnedQuery.isPending)
    const isError = listQuery.isError || pinnedQuery.isError

    return (
        <PageLayout className="grow min-h-0" title="Sessions">
            <div className="flex flex-col flex-1 min-h-0">
                <SessionFiltersBar waitingCount={pendingBySession?.size} />

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {isError ? (
                        <SessionListError
                            onRetry={() => {
                                void listQuery.refetch()
                                void pinnedQuery.refetch()
                            }}
                        />
                    ) : isLoading ? (
                        <SessionListSkeleton />
                    ) : (
                        <>
                            {pinnedRows.length > 0 ? (
                                <>
                                    <p className="m-0 px-3 py-1 text-xs text-colorTextTertiary bg-colorFillQuaternary">
                                        Pinned {pinnedRows.length}
                                    </p>
                                    {pinnedRows.map((row) => renderRow(row, true))}
                                </>
                            ) : null}

                            {rows.map((row) => renderRow(row, false))}

                            {rows.length === 0 && pinnedRows.length === 0 ? (
                                <SessionListEmpty
                                    filtered={filtersActive}
                                    onClearFilters={resetFilters}
                                />
                            ) : null}

                            {listQuery.hasNextPage ? (
                                <div className="flex justify-center py-3">
                                    <Button
                                        loading={listQuery.isFetchingNextPage}
                                        onClick={() => void listQuery.fetchNextPage()}
                                    >
                                        Load more
                                    </Button>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        </PageLayout>
    )
}

export default SessionsPage
