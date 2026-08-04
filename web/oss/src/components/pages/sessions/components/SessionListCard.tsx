import {useCallback, useMemo} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {PushPinIcon} from "@phosphor-icons/react"
import {Dropdown, Skeleton, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"
import Link from "next/link"

import {RAIL_CARD_CLASS} from "@/oss/assets/railCard"
import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

import {sessionPreviewText} from "../assets/sessionPreview"
import {pendingGateLabel, sessionRowStatus} from "../assets/sessionRowStatus"
import {applySessionScopeAtom} from "../state/filters"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "../state/pins"
import {
    pendingBySessionId,
    rowsFromPages,
    useActionableInteractions,
    useSessionList,
} from "../state/useSessionList"

import SessionAgentLabel from "./SessionAgentLabel"

interface Props {
    title: string
    /** Scope to one agent's sessions — the app overview. Omit for the whole project. */
    agentId?: string
    /** Restrict to one origin (e.g. automation runs). Omit for everything but automations. */
    origin?: string
    emptyText: string
    limit?: number
    /** Pinned sessions lead the list, and are excluded from the recent rows below them. */
    withPinned?: boolean
    /** Floor for the card in a column layout — a short card should not collapse to a sliver.
     * Keep it close to the empty state's natural height; a floor far above the content turns
     * into a visible void, which reads as a rendering failure rather than an empty list. */
    minHeightClassName?: string
}

/**
 * A session list for Home — the same rows and the same right-click actions as the sessions page,
 * so the two surfaces stay one thing rather than two that look alike.
 *
 * Groups run waiting → pinned → recent. Waiting leads because a blocked session is the only row
 * that costs you something to miss; the rest is history you can browse at your own pace.
 */
const SessionListCard = ({
    title,
    agentId,
    origin,
    emptyText,
    limit = 7,
    withPinned = false,
    minHeightClassName,
}: Props) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)
    const applyScope = useSetAtom(applySessionScopeAtom)
    const openSession = useOpenAgentSession()
    const actions = useSessionActions()
    const {projectURL} = useURL()

    const interactions = useActionableInteractions(projectId)
    const pendingBySession = useMemo(
        () => pendingBySessionId(interactions.data),
        [interactions.data],
    )

    // The gate poll is project-wide, so the ids alone can't be trusted as this card's waiting set —
    // they go back to the server as a `session_ids` pushdown, which intersects them with the card's
    // own scope (agent, origin, archived). Membership and order stay the server's.
    const waitingIds = useMemo(
        () => (pendingBySession ? [...pendingBySession.keys()] : []),
        [pendingBySession],
    )
    const useWaiting = waitingIds.length > 0

    const waitingQuery = useSessionList({
        agentId,
        origin,
        sessionIds: waitingIds,
        showTriggered: Boolean(origin),
        enabled: useWaiting,
    })
    const usePins = withPinned && pinnedIds.length > 0
    const pinnedQuery = useSessionList({agentId, origin, sessionIds: pinnedIds, enabled: usePins})
    const listQuery = useSessionList({
        agentId,
        origin,
        excludeSessionIds: withPinned ? [...pinnedIds, ...waitingIds] : waitingIds,
        // Automations are their own list here, so they must not also appear in the recent one.
        showTriggered: Boolean(origin),
    })

    // Membership stays the server's, but which GROUP a loaded row renders in is decided here —
    // otherwise pinning waits for two queries to come back before anything moves. Rows are taken
    // from whichever query already has them, so the move costs no fetch.
    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    const listRows = rowsFromPages(listQuery.data?.pages)
    const waitingRowsAll = useWaiting ? rowsFromPages(waitingQuery.data?.pages) : []
    const waitingSet = useMemo(
        () => new Set(waitingRowsAll.map((row) => row.session_id)),
        [waitingRowsAll],
    )
    const knownById = useMemo(() => {
        const byId = new Map<string, SessionStream>()
        for (const row of [...(usePins ? rowsFromPages(pinnedQuery.data?.pages) : []), ...listRows])
            byId.set(row.session_id, row)
        return byId
    }, [pinnedQuery.data?.pages, listRows, usePins])

    // `limit` caps the CARD, not each group. Applying it per-group made every pin add a row at
    // the top without dropping one at the bottom, so the card grew by a row each time — which is
    // the height change you see mid-transition. Pinning a visible row is now a pure reorder.
    const waitingRows = waitingRowsAll.slice(0, limit)
    // A waiting session that is also pinned renders once, in the group you must act on.
    const allPinned = usePins
        ? pinnedIds.flatMap((id) => {
              const row = knownById.get(id)
              return row && !waitingSet.has(id) ? [row] : []
          })
        : []
    const pinnedRows = allPinned.slice(0, Math.max(0, limit - waitingRows.length))
    const rows = listRows
        .filter((row) => !pinnedSet.has(row.session_id) && !waitingSet.has(row.session_id))
        .slice(0, Math.max(0, limit - waitingRows.length - pinnedRows.length))

    const isEmpty = rows.length === 0 && pinnedRows.length === 0 && waitingRows.length === 0
    // A lone "Recent" heading over a plain list is noise; it only earns its place as a boundary.
    const grouped = waitingRows.length > 0 || pinnedRows.length > 0

    const handleOpen = useCallback(
        (row: SessionStream) => {
            const target = sessionOpenTarget(row)
            if (target) openSession(target)
        },
        [openSession],
    )

    // Every link out of this card lands on the set the card was showing, not on a default list.
    const handleViewAll = useCallback(() => {
        applyScope({agentId, origin})
    }, [agentId, applyScope, origin])
    const handleWaitingClick = useCallback(() => {
        applyScope({agentId, origin, status: "waiting"})
    }, [agentId, applyScope, origin])

    const renderRow = (row: SessionStream, pinned: boolean) => {
        const pending = pendingBySession?.get(row.session_id)
        const status = sessionRowStatus(row, pending?.count)
        const preview = sessionPreviewText(row)
        const target = sessionOpenTarget(row)
        const activity = row.updated_at ?? row.created_at
        const actionTarget = {
            sessionId: row.session_id,
            appId: target?.appId ?? null,
            name: row.name,
            archived: Boolean(row.archived_at),
        }

        return (
            <motion.div
                key={row.session_id}
                layout
                variants={ROW_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                className="overflow-hidden"
            >
                <Dropdown
                    trigger={["contextMenu"]}
                    menu={{
                        items: actions.menuItems(actionTarget, {onOpen: () => handleOpen(row)}),
                        onClick: actions.onMenuClick(actionTarget, {onOpen: () => handleOpen(row)}),
                    }}
                >
                    <button
                        type="button"
                        onClick={() => handleOpen(row)}
                        className="group box-border flex w-full cursor-pointer flex-col gap-0.5 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-2 text-left hover:bg-colorFillQuaternary"
                    >
                        <span className="flex w-full items-center gap-2">
                            <Tooltip title={status.label}>
                                <span
                                    className={`h-2 w-2 shrink-0 rounded-full ${status.dotClassName} ${
                                        status.pulse ? "motion-safe:animate-pulse" : ""
                                    }`}
                                />
                            </Tooltip>
                            <span className="min-w-0 flex-1 truncate text-xs text-colorText">
                                {row.name?.trim() || "Untitled session"}
                            </span>
                            {/* Inside a "Waiting on you" group the urgency is already stated, so the
                            chip spends itself on WHAT is being asked and stays visually quiet —
                            the amber lives on the dot and the header badge. */}
                            {status.chipLabel ? (
                                <span className="shrink-0 rounded bg-colorFillSecondary px-1.5 py-0.5 text-[11px] leading-none text-colorTextSecondary">
                                    {pendingGateLabel(pending?.kinds)}
                                </span>
                            ) : null}
                            {/* An agent-scoped card is already one agent's, so naming it on every row
                            spends a third of the row width restating the heading. */}
                            {agentId ? null : (
                                <span className="w-24 shrink-0 truncate text-right">
                                    <SessionAgentLabel appId={target?.appId ?? null} />
                                </span>
                            )}
                            <span className="w-14 shrink-0 text-right text-xs text-colorTextTertiary">
                                {activity ? timeAgo(Date.parse(activity)) : "—"}
                            </span>
                            <Tooltip title={pinned ? "Unpin" : "Pin"}>
                                <span
                                    role="button"
                                    tabIndex={-1}
                                    aria-label={pinned ? "Unpin session" : "Pin session"}
                                    onClick={(event) => {
                                        event.stopPropagation()
                                        togglePin(row.session_id)
                                    }}
                                    className={`shrink-0 text-colorTextTertiary ${
                                        pinned ? "" : "opacity-0 group-hover:opacity-100"
                                    }`}
                                >
                                    <PushPinIcon size={14} weight={pinned ? "fill" : "regular"} />
                                </span>
                            </Tooltip>
                        </span>
                        {/* What actually happened, so deciding whether to reopen a session
                            doesn't mean opening it. Indented past the status dot. */}
                        {preview ? (
                            <span className="min-w-0 truncate pl-4 text-[11px] text-colorTextTertiary">
                                {preview}
                            </span>
                        ) : null}
                    </button>
                </Dropdown>
            </motion.div>
        )
    }

    const groupHeading = (key: string, label: string) => (
        <motion.p
            key={key}
            layout
            variants={ROW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="m-0 overflow-hidden px-2 pt-1 text-[11px] uppercase tracking-wide text-colorTextTertiary"
        >
            {label}
        </motion.p>
    )

    return (
        // `pt-0` hands the card's top padding to the sticky header below (Tailwind emits `pt-*`
        // after `py-*`, so it wins); without that the header would stick flush to the rail's edge.
        <section className={`flex flex-col ${RAIL_CARD_CLASS} pt-0 ${minHeightClassName ?? ""}`}>
            {/* Sticky within its own card, so scrolling a long list never leaves you looking at
                rows that don't say which list they belong to. The card's top padding moved onto
                this element (`pt-3` here, `pt-0` on the section) so the spacing above the title
                is identical stuck or unstuck, and the opaque background is what the rows pass
                behind. The section must NOT get `overflow-hidden` to clip its corners against
                this — that would make it the scroll container and the header would stop
                sticking at all. */}
            <div className="sticky top-0 z-10 mb-1 flex items-center justify-between gap-2 bg-colorBgContainer pb-1 pt-3">
                <div className="flex min-w-0 items-center gap-2">
                    <h3 className="m-0 text-xs font-medium text-colorText">{title}</h3>
                    {waitingRowsAll.length > 0 ? (
                        <Link
                            href={`${projectURL}/sessions`}
                            onClick={handleWaitingClick}
                            className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                        >
                            {waitingRowsAll.length} waiting
                        </Link>
                    ) : null}
                </div>
                <Link
                    href={`${projectURL}/sessions`}
                    onClick={handleViewAll}
                    className="shrink-0 text-xs"
                >
                    View all
                </Link>
            </div>

            {listQuery.isPending ? (
                <Skeleton active paragraph={{rows: 4}} title={false} />
            ) : (
                <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                    {/* `grow`, NOT `flex-1`: `flex-1` sets `flex-basis: 0`, so this card sized
                        itself as though the list were empty and every row past the min-height
                        floor spilled out of the bottom border. `grow` keeps the content's own
                        height and still fills the floor's leftover, which is all the empty
                        state needed it for. */}
                    <div className="flex grow flex-col">
                        <AnimatePresence initial={false}>
                            {waitingRows.length > 0
                                ? groupHeading("waiting-heading", "Waiting on you")
                                : null}
                            {waitingRows.map((row) =>
                                renderRow(row, pinnedSet.has(row.session_id)),
                            )}
                            {pinnedRows.length > 0
                                ? groupHeading("pinned-heading", "Pinned")
                                : null}
                            {pinnedRows.map((row) => renderRow(row, true))}
                            {/* Without this the recent rows read as a continuation of "Pinned" —
                                a labelled group followed by unlabelled rows has no visible end. */}
                            {grouped && rows.length > 0
                                ? groupHeading("recent-heading", "Recent")
                                : null}
                            {rows.map((row) => renderRow(row, false))}
                        </AnimatePresence>

                        {isEmpty ? (
                            <p className="m-0 flex grow items-center px-2 py-3 text-xs text-colorTextTertiary">
                                {emptyText}
                            </p>
                        ) : null}
                    </div>
                </MotionConfig>
            )}
        </section>
    )
}

export default SessionListCard
