import {Fragment, useCallback} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {type SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {PageLayout} from "@agenta/ui"
import {Button} from "antd"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

import SessionFiltersRail from "./components/SessionFiltersRail"
import SessionRow from "./components/SessionRow"
import {SessionListEmpty, SessionListError, SessionListSkeleton} from "./states/SessionListStates"

interface Props {
    /** Route-supplied agent scope (`/apps/[app_id]/sessions`). Omit for the project-wide list. */
    scopedAgentId?: string
    title?: string
}

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

/**
 * The session list — sessions are the unit of work, so this is where they get organised. The
 * organisation itself (groups, pins, filter semantics, paging) is `@agenta/sessions`' decision;
 * this page renders the groups it is handed and wires the app-side actions (open on a
 * playground, the shared context menu).
 */
const SessionsPage = ({scopedAgentId, title = "Sessions"}: Props) => {
    const list = useSessionsList({agentId: scopedAgentId})
    const {toggle: togglePin} = useSessionPins()
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()

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

    const renderRow = (vm: SessionRowVm) => (
        <motion.div
            key={vm.id}
            layout
            variants={ROW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden"
        >
            <SessionRow
                key={vm.id}
                row={vm.stream}
                pinned={vm.isPinned}
                pending={vm.pending}
                menuItems={sessionActions.menuItems}
                showAgent={!scopedAgentId}
                {...actions}
            />
        </motion.div>
    )

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <div className="flex min-h-0 w-full flex-1 flex-col lg:flex-row">
                <SessionFiltersRail
                    title={title}
                    waitingCount={list.waitingCount}
                    hideAgentFilter={Boolean(scopedAgentId)}
                />

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
                    {list.isError ? (
                        <SessionListError onRetry={list.refetch} />
                    ) : list.isPending ? (
                        <SessionListSkeleton />
                    ) : (
                        <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                            {/* Group headers sit OUTSIDE AnimatePresence. Framer bumps z-index on
                                layout-animating elements, so an animated row paints over a sticky
                                sibling no matter which element carries the `sticky`. Keeping the
                                headers out of the animated subtree removes the fight entirely. */}
                            {list.groups.map((group) => (
                                <Fragment key={group.key}>
                                    {group.label ? <GroupHeader label={group.label} /> : null}
                                    <AnimatePresence initial={false}>
                                        {group.rows.map(renderRow)}
                                    </AnimatePresence>
                                </Fragment>
                            ))}

                            {list.paging.hasNext ? (
                                <LoadMore
                                    loading={list.paging.isLoadingNext}
                                    onClick={list.paging.loadNext}
                                />
                            ) : null}

                            {list.isEmpty ? (
                                <SessionListEmpty
                                    filtered={list.filtersActive}
                                    onClearFilters={list.resetFilters}
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
