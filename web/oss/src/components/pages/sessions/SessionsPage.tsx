import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {
    resetSessionFiltersAtom,
    sessionAgentFilterAtom,
    sessionFiltersActiveAtom,
    sessionFiltersActiveExceptAgentAtom,
    sessionSearchAtom,
    sessionShowArchivedAtom,
    sessionShowTriggeredAtom,
    sessionStatusFilterAtom,
} from "@agenta/sessions/state"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "@agenta/sessions/state"
import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "@agenta/sessions/state"
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

import SessionFiltersRail from "./components/SessionFiltersRail"
import SessionRow from "./components/SessionRow"
import {SessionListEmpty, SessionListError, SessionListSkeleton} from "./states/SessionListStates"

interface Props {
    /** Route-supplied agent scope (`/apps/[app_id]/sessions`). Omit for the project-wide list. */
    scopedAgentId?: string
    title?: string
}

/**
 * The session list — sessions are the unit of work, so this is where they get organised. Pins
 * render as their own group, fetched by id, and are excluded from the main list so nothing appears
 * twice; both queries are server-ordered, so there is only ever one ordering.
 *
 * `scopedAgentId` makes the same page serve an agent's own list. It overrides the agent filter
 * rather than writing to it, so the project page's filter is never left holding a value the user
 * did not choose.
 */
/** One group's pager. Each group loads its own next page, in place. */
const LoadMore = ({loading, onClick}: {loading: boolean; onClick: () => void}) => (
    <div className="flex justify-center py-3">
        <Button loading={loading} onClick={onClick}>
            Load more
        </Button>
    </div>
)

/** A list group's heading. Plain (non-motion) so `sticky` is never fighting a transform. */
const GroupHeader = ({label}: {label: string}) => (
    <div className="sticky top-0 z-20 -mx-6 bg-colorBgContainer px-6 pb-1 pt-4">
        <p className="m-0 rounded bg-colorBgElevated px-3 py-1 text-xs text-colorTextTertiary">
            {label}
        </p>
    </div>
)

const SessionsPage = ({scopedAgentId, title = "Sessions"}: Props) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const search = useAtomValue(sessionSearchAtom)
    const agentFilter = useAtomValue(sessionAgentFilterAtom)
    const agentId = scopedAgentId ?? agentFilter
    const status = useAtomValue(sessionStatusFilterAtom)
    const includeArchived = useAtomValue(sessionShowArchivedAtom)
    const showTriggered = useAtomValue(sessionShowTriggeredAtom)
    const projectFiltersActive = useAtomValue(sessionFiltersActiveAtom)
    const scopedFiltersActive = useAtomValue(sessionFiltersActiveExceptAgentAtom)
    const filtersActive = scopedAgentId ? scopedFiltersActive : projectFiltersActive
    const resetFilters = useSetAtom(resetSessionFiltersAtom)
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingBySessionId(interactions.data),
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
    // The automations switch picks WHICH sessions, it doesn't add a second set: one list, one
    // pager. Mixing both in one recency-ordered feed meant a busy schedule buried your own
    // sessions, and grouping them client-side made paging back-fill a group above another.
    const listQuery = useSessionList({
        ...shared,
        origin: showTriggered ? "trigger" : undefined,
        excludeSessionIds: pinnedIds,
    })

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
                pending={pendingBySession?.get(row.session_id)}
                menuItems={sessionActions.menuItems}
                showAgent={!scopedAgentId}
                {...actions}
            />
        </motion.div>
    )

    const isLoading = listQuery.isPending || (pinnedIds.length > 0 && pinnedQuery.isPending)
    const isError = listQuery.isError || pinnedQuery.isError

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
                <SessionFiltersRail
                    title={title}
                    waitingCount={pendingBySession?.size}
                    hideAgentFilter={Boolean(scopedAgentId)}
                />

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
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
                            {/* Group headers sit OUTSIDE AnimatePresence. Framer bumps z-index on
                                layout-animating elements, so an animated row paints over a sticky
                                sibling no matter which element carries the `sticky`. Keeping the
                                headers out of the animated subtree removes the fight entirely. */}
                            {pinnedRows.length > 0 ? (
                                <GroupHeader label={`Pinned ${pinnedRows.length}`} />
                            ) : null}
                            <AnimatePresence initial={false}>
                                {pinnedRows.map((row) => renderRow(row, true))}
                            </AnimatePresence>

                            {/* The pinned group needs a counterpart, or the rows below it read as
                                more pinned ones that lost their heading. */}
                            {pinnedRows.length > 0 && rows.length > 0 ? (
                                <GroupHeader label={showTriggered ? "Automation runs" : "Recent"} />
                            ) : null}
                            <AnimatePresence initial={false}>
                                {rows.map((row) => renderRow(row, false))}
                            </AnimatePresence>

                            {listQuery.hasNextPage ? (
                                <LoadMore
                                    loading={listQuery.isFetchingNextPage}
                                    onClick={() => void listQuery.fetchNextPage()}
                                />
                            ) : null}

                            {rows.length === 0 && pinnedRows.length === 0 ? (
                                <SessionListEmpty
                                    filtered={filtersActive}
                                    onClearFilters={resetFilters}
                                />
                            ) : null}
                        </MotionConfig>
                    )}
                </div>
            </div>
        </PageLayout>
    )
}

export default SessionsPage
