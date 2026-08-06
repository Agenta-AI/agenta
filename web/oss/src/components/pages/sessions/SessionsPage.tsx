import {Fragment, useCallback} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {
    SessionGroupHeader,
    SessionListEmpty,
    SessionListError,
    SessionListLoadMore,
    SessionListSkeleton,
    SessionRow,
} from "@agenta/sessions-ui"
import {PageLayout} from "@agenta/ui"
import {Dropdown} from "antd"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {
    useSessionActions,
    type SessionActionTarget,
} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"

import {toSessionMenuEntries} from "./assets/menuEntries"
import SessionFiltersRail from "./components/SessionFiltersRail"

interface Props {
    /** Route-supplied agent scope (`/apps/[app_id]/sessions`). Omit for the project-wide list. */
    scopedAgentId?: string
    title?: string
}

/**
 * The session list — sessions are the unit of work, so this is where they get organised. The
 * organisation (groups, pins, filter semantics, paging) is `@agenta/sessions`' decision and the
 * rows are `@agenta/sessions-ui`'s; this page owns the shell, the motion, and the app-side
 * actions (open on a playground, the shared context menu).
 */
const SessionsPage = ({scopedAgentId, title = "Sessions"}: Props) => {
    const list = useSessionsList({agentId: scopedAgentId})
    const {toggle: togglePin} = useSessionPins()
    const openSession = useOpenAgentSession()
    const sessionActions = useSessionActions()

    const renderRow = useCallback(
        (vm: SessionRowVm) => {
            const target: SessionActionTarget = {
                sessionId: vm.id,
                appId: vm.agentId,
                name: vm.stream.name,
                archived: Boolean(vm.stream.archived_at),
            }
            const open = () => {
                if (vm.agentId)
                    openSession({
                        appId: vm.agentId,
                        sessionId: vm.id,
                        title: vm.stream.name?.trim() || undefined,
                    })
            }
            const onSelect = (key: string) => {
                if (key === "open") open()
                if (key === "rename") sessionActions.rename(target)
                if (key === "pin") togglePin(vm.id)
                if (key === "archive") void sessionActions.setArchived(target)
                if (key === "delete") sessionActions.remove(target)
            }
            const items = sessionActions.menuItems(target, {onOpen: open})

            return (
                <motion.div
                    key={vm.id}
                    layout
                    variants={ROW_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="overflow-hidden"
                >
                    {/* Right-click stays an app affordance (antd, matching the playground's
                        session bar); the row's own kebab renders the same verbs via the
                        package's neutral menu. */}
                    <Dropdown
                        trigger={["contextMenu"]}
                        menu={{
                            items,
                            onClick: ({key, domEvent}) => {
                                domEvent.stopPropagation()
                                onSelect(key)
                            },
                        }}
                    >
                        <div>
                            <SessionRow
                                row={vm}
                                showAgent={!scopedAgentId}
                                menuItems={toSessionMenuEntries(items)}
                                onMenuSelect={onSelect}
                                onOpen={open}
                                onTogglePin={togglePin}
                            />
                        </div>
                    </Dropdown>
                </motion.div>
            )
        },
        [openSession, scopedAgentId, sessionActions, togglePin],
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
                                    {group.label ? (
                                        <SessionGroupHeader label={group.label} />
                                    ) : null}
                                    <AnimatePresence initial={false}>
                                        {group.rows.map(renderRow)}
                                    </AnimatePresence>
                                </Fragment>
                            ))}

                            {list.paging.hasNext ? (
                                <SessionListLoadMore
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
