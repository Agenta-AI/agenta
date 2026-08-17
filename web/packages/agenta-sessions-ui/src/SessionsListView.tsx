/**
 * The sessions PAGE body — the grouped, filterable, paged list from the desktop sessions page,
 * extracted so desktop and mobile render the same organisation (groups, pins, filter semantics,
 * paging are `useSessionsList`'s decisions). The host supplies only its verbs: how a row opens
 * and its menu entries; everything else — rows, group headers, skeleton/error/empty states,
 * load-more, the enter/exit motion — lives here.
 */
import {Fragment, useCallback} from "react"

import {type SessionRowVm} from "@agenta/sessions/row"
import {useSessionPins, useSessionsList} from "@agenta/sessions/state"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "./assets/motion"
import {type SessionMenuEntry} from "./menu"
import {
    SessionGroupHeader,
    SessionListEmpty,
    SessionListError,
    SessionListLoadMore,
    SessionListSkeleton,
} from "./SessionListStates"
import {SessionRow} from "./SessionRow"
import {SessionRowContextMenu} from "./SessionRowContextMenu"

export interface SessionsListViewProps {
    /** Route-supplied agent scope; omit for the project-wide list. */
    scopedAgentId?: string
    /** Open a row (host routing: playground session, mobile chat route…). */
    onOpenRow: (vm: SessionRowVm) => void
    /** The host's verbs for a row's kebab + right-click; omit for no menu. */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Touch surfaces have no hover — keep row actions always visible there. */
    revealActionsOnHover?: boolean
    className?: string
}

export const SessionsListView = ({
    scopedAgentId,
    onOpenRow,
    menuFor,
    onMenuSelect,
    revealActionsOnHover = true,
    className,
}: SessionsListViewProps) => {
    const list = useSessionsList({
        agentId: scopedAgentId,
        // Release contract: the human list hides automation runs; the "show triggered" toggle
        // swaps in the automation policy. See the QA note in the merge log.
        defaultPolicy: {origin: "exclude-trigger", expansions: []},
        automationPolicy: {origin: "trigger-only", expansions: ["trigger"]},
    })
    const {toggle: togglePin} = useSessionPins()

    const renderRow = useCallback(
        (vm: SessionRowVm) => {
            const entries = menuFor?.(vm)
            return (
                <motion.div
                    key={vm.id}
                    // Position only, never size — see SessionCardList: a full `layout` in a
                    // resizable pane clips rows at a stale width.
                    layout="position"
                    variants={ROW_VARIANTS}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    className="overflow-hidden"
                >
                    <SessionRowContextMenu
                        entries={entries}
                        onSelect={(key) => onMenuSelect?.(vm, key)}
                    >
                        <div>
                            <SessionRow
                                row={vm}
                                showAgent={!scopedAgentId}
                                revealActionsOnHover={revealActionsOnHover}
                                menuItems={entries}
                                onMenuSelect={(key) => onMenuSelect?.(vm, key)}
                                onOpen={() => onOpenRow(vm)}
                                onTogglePin={togglePin}
                            />
                        </div>
                    </SessionRowContextMenu>
                </motion.div>
            )
        },
        [menuFor, onMenuSelect, onOpenRow, revealActionsOnHover, scopedAgentId, togglePin],
    )

    // Every state renders inside the SAME box: `className` is where the host puts the page's
    // gutters and its centered column, so returning the skeleton or the error bare made the list
    // full-bleed until data arrived and then snap into the column on the first painted row.
    if (list.isError)
        return (
            <div className={className}>
                <SessionListError onRetry={list.refetch} />
            </div>
        )
    if (list.isPending)
        return (
            <div className={className}>
                <SessionListSkeleton />
            </div>
        )

    return (
        <div className={className}>
            <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                {/* Group headers sit OUTSIDE AnimatePresence: framer bumps z-index on
                    layout-animating elements, which paints rows over a sticky sibling. */}
                {list.groups.map((group) => (
                    <Fragment key={group.key}>
                        {group.label ? <SessionGroupHeader label={group.label} /> : null}
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
        </div>
    )
}
