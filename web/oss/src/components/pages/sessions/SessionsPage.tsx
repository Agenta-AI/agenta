import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {PageLayout} from "@agenta/ui"
import {Button} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
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
    sessionShowTriggeredAtom,
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
    const showTriggered = useAtomValue(sessionShowTriggeredAtom)
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

    const shared = {
        search,
        agentId,
        status,
        includeArchived,
        showTriggered,
        waitingSessionIds: waitingIds,
    }
    const pinnedQuery = useSessionList({
        ...shared,
        sessionIds: pinnedIds,
        enabled: pinnedIds.length > 0,
    })
    const listQuery = useSessionList({...shared, excludeSessionIds: pinnedIds})

    // Which group a loaded row shows in is decided here, so pinning moves it on the same frame
    // rather than after both queries refetch under their new keys.
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    const listRows = rowsFromPages(listQuery.data?.pages)
    const knownById = useMemo(() => {
        const byId = new Map<string, SessionStream>()
        for (const row of [...rowsFromPages(pinnedQuery.data?.pages), ...listRows])
            byId.set(row.session_id, row)
        return byId
    }, [pinnedQuery.data?.pages, listRows])
    const pinnedRows = pinnedIds.flatMap((id) => {
        const row = knownById.get(id)
        return row ? [row] : []
    })
    const rows = listRows.filter((row) => !pinnedSet.has(row.session_id))

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
        <motion.div
            key={row.session_id}
            layout
            variants={ROW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden"
        >
            <SessionRow
                key={row.session_id}
                row={row}
                pinned={pinned}
                pendingCount={pendingBySession?.get(row.session_id)}
                menuItems={sessionActions.menuItems}
                {...actions}
            />
        </motion.div>
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
                        <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                            <AnimatePresence initial={false}>
                                {pinnedRows.length > 0 ? (
                                    <motion.p
                                        key="pinned-heading"
                                        layout
                                        variants={ROW_VARIANTS}
                                        initial="initial"
                                        animate="animate"
                                        exit="exit"
                                        className="m-0 overflow-hidden bg-colorFillQuaternary px-3 py-1 text-xs text-colorTextTertiary"
                                    >
                                        Pinned {pinnedRows.length}
                                    </motion.p>
                                ) : null}
                                {pinnedRows.map((row) => renderRow(row, true))}
                                {rows.map((row) => renderRow(row, false))}
                            </AnimatePresence>

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
                        </MotionConfig>
                    )}
                </div>
            </div>
        </PageLayout>
    )
}

export default SessionsPage
