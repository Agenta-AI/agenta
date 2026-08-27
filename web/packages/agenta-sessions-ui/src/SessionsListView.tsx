/**
 * The sessions PAGE body — the grouped, filterable, paged list from the desktop sessions page,
 * extracted so desktop and mobile render the same organisation (groups, pins, filter semantics,
 * paging are `useSessionsList`'s decisions). The host supplies only its verbs: how a row opens
 * and its menu entries; everything else — rows, group headers, skeleton/error/empty states,
 * load-more, the enter/exit motion — lives here.
 */
import {Fragment, useCallback, useMemo} from "react"

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
import {useInlineRename} from "./useInlineRename"

export interface SessionsListViewProps {
    /** Route-supplied agent scope; omit for the project-wide list. */
    scopedAgentId?: string
    /** Open a row (host routing: playground session, mobile chat route…). */
    onOpenRow: (vm: SessionRowVm) => void
    /** The host's verbs for a row's kebab + right-click; omit for no menu. */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /**
     * Persists a rename. Given this, a row renames IN PLACE from either menu; without it the
     * "rename" key falls through to `onMenuSelect` like any other verb.
     */
    onRenameRow?: (vm: SessionRowVm, name: string) => Promise<boolean>
    /** Touch surfaces have no hover — keep row actions always visible there. */
    revealActionsOnHover?: boolean
    className?: string
}

/**
 * One row, and the owner of its rename state.
 *
 * A row is offered "rename" twice — its kebab and the right-click menu that wraps it — and both
 * have to drive the same edit. A component per row is what lets one `useInlineRename` sit above
 * both; a callback in the parent's render loop could not hold the state.
 */
const SessionsListRow = ({
    vm,
    entries,
    scopedAgentId,
    revealActionsOnHover,
    onMenuSelect,
    onRenameRow,
    onOpenRow,
    togglePin,
}: {
    vm: SessionRowVm
    entries?: SessionMenuEntry[]
    scopedAgentId?: string
    revealActionsOnHover?: boolean
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    onRenameRow?: (vm: SessionRowVm, name: string) => Promise<boolean>
    onOpenRow: (vm: SessionRowVm) => void
    togglePin: (sessionId: string) => void
}) => {
    const onRename = useMemo(
        () => (onRenameRow ? (name: string) => onRenameRow(vm, name) : undefined),
        [onRenameRow, vm],
    )
    const rename = useInlineRename({current: vm.title, onCommit: onRename ?? (async () => false)})

    const onSelect = useCallback(
        (key: string) => {
            if (key === "rename" && onRename) {
                rename.start()
                return
            }
            onMenuSelect?.(vm, key)
        },
        [onMenuSelect, onRename, rename, vm],
    )

    return (
        <SessionRowContextMenu entries={entries} onSelect={onSelect}>
            <div>
                <SessionRow
                    row={vm}
                    showAgent={!scopedAgentId}
                    revealActionsOnHover={revealActionsOnHover}
                    menuItems={entries}
                    onMenuSelect={onSelect}
                    rename={onRename ? rename : undefined}
                    onOpen={() => onOpenRow(vm)}
                    onTogglePin={togglePin}
                />
            </div>
        </SessionRowContextMenu>
    )
}

export const SessionsListView = ({
    scopedAgentId,
    onOpenRow,
    menuFor,
    onMenuSelect,
    onRenameRow,
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
                    <SessionsListRow
                        vm={vm}
                        entries={entries}
                        scopedAgentId={scopedAgentId}
                        revealActionsOnHover={revealActionsOnHover}
                        onMenuSelect={onMenuSelect}
                        onRenameRow={onRenameRow}
                        onOpenRow={onOpenRow}
                        togglePin={togglePin}
                    />
                </motion.div>
            )
        },
        [
            menuFor,
            onMenuSelect,
            onOpenRow,
            onRenameRow,
            revealActionsOnHover,
            scopedAgentId,
            togglePin,
        ],
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
