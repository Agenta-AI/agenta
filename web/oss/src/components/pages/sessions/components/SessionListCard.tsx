import {useCallback, useMemo, useState} from "react"

import {type SessionStream} from "@agenta/entities/session"
import {ArrowRightIcon, ChatCircleIcon, ClockIcon, PushPinIcon} from "@phosphor-icons/react"
import {Dropdown, Skeleton, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"
import Link from "next/link"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {sessionOpenTarget} from "@/oss/components/AgentChatSlice/assets/sessionOpenTarget"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import {PANEL_ACTION_CLASS, PanelSection} from "@/oss/components/PanelSection"
import useURL from "@/oss/hooks/useURL"
import {projectIdAtom} from "@/oss/state/project"

import {sessionPreviewText} from "../assets/sessionPreview"
import {pendingGateLabel, sessionRowStatus} from "../assets/sessionRowStatus"
import {sessionRowTitle} from "../assets/sessionRowTitle"
import {sessionTriggerName} from "../assets/sessionTrigger"
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
    /** Where the header links go. Defaults to the project sessions page, which needs the agent
     * handed over as a filter; an agent-scoped page carries that in its own route instead. */
    viewAllHref?: string
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
    viewAllHref,
}: Props) => {
    // Revealed in place, a page at a time. "View all" leaves for a filterable page; wanting three
    // more rows is not that errand, and the list's own query already holds the next page.
    const [extraRows, setExtraRows] = useState(0)
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
    const shownLimit = limit + extraRows
    const waitingRows = waitingRowsAll.slice(0, shownLimit)
    // A waiting session that is also pinned renders once, in the group you must act on.
    const allPinned = usePins
        ? pinnedIds.flatMap((id) => {
              const row = knownById.get(id)
              return row && !waitingSet.has(id) ? [row] : []
          })
        : []
    const pinnedRows = allPinned.slice(0, Math.max(0, shownLimit - waitingRows.length))
    const rows = listRows
        // Only a card that RENDERS a pinned group may withhold pinned rows from here. Automation
        // runs doesn't, so filtering them out unconditionally made pinning one delete it from view.
        .filter(
            (row) =>
                (!withPinned || !pinnedSet.has(row.session_id)) && !waitingSet.has(row.session_id),
        )
        .slice(0, Math.max(0, shownLimit - waitingRows.length - pinnedRows.length))

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
    // A route-scoped destination already owns the agent, so handing it over as a filter too would
    // leave the project page holding an agent the user never picked.
    const scopedHref = viewAllHref ?? `${projectURL}/sessions`
    const linkScope = useMemo(
        () => ({agentId: viewAllHref ? null : agentId, origin}),
        [agentId, origin, viewAllHref],
    )
    const handleViewAll = useCallback(() => {
        applyScope(linkScope)
    }, [applyScope, linkScope])
    // More rows exist if the loaded set already exceeds what is shown, or the server has another
    // page to give.
    const canShowMore =
        !isEmpty &&
        (listRows.length > rows.length + pinnedRows.length + waitingRows.length ||
            Boolean(listQuery.hasNextPage))
    const handleShowMore = useCallback(() => {
        setExtraRows((shown) => shown + limit)
        if (listQuery.hasNextPage && !listQuery.isFetchingNextPage) void listQuery.fetchNextPage()
    }, [limit, listQuery])

    const handleWaitingClick = useCallback(() => {
        applyScope({...linkScope, status: "waiting"})
    }, [applyScope, linkScope])

    const renderRow = (row: SessionStream, pinned: boolean) => {
        const pending = pendingBySession?.get(row.session_id)
        const status = sessionRowStatus(row, pending?.count)
        const {title, subtitle} = sessionRowTitle(
            row.name,
            sessionPreviewText(row),
            sessionTriggerName(row),
        )
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
                        className="group box-border flex w-full cursor-pointer items-start gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-3 text-left hover:bg-colorFillQuaternary"
                    >
                        {/* A glyph for the KIND of row, with the status as a dot on its shoulder.
                            Two lists in the same column read as one long list when every row leads
                            with the same dot; the clock and the chat bubble separate them without
                            a heading. */}
                        <Tooltip title={status.label}>
                            <span className="relative mt-0.5 flex shrink-0 text-colorTextTertiary">
                                {origin ? <ClockIcon size={18} /> : <ChatCircleIcon size={18} />}
                                <span
                                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-solid border-colorBgContainer ${status.dotClassName} ${
                                        status.pulse ? "motion-safe:animate-pulse" : ""
                                    }`}
                                />
                            </span>
                        </Tooltip>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex w-full items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm text-colorText">
                                    {title}
                                </span>
                                {/* Inside a "Waiting on you" group the urgency is already stated, so the
                            chip spends itself on WHAT is being asked and stays visually quiet —
                            the amber lives on the dot and the header badge. The fill is the
                            faintest available: a solid pill beside a title reads as a button,
                            and this chip is a label. */}
                                {status.chipLabel ? (
                                    <span className="shrink-0 rounded bg-colorFillQuaternary px-1.5 py-0.5 text-xs leading-none text-colorTextSecondary">
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
                                <span className="w-16 shrink-0 text-right text-xs text-colorTextTertiary">
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
                                        <PushPinIcon
                                            size={14}
                                            weight={pinned ? "fill" : "regular"}
                                        />
                                    </span>
                                </Tooltip>
                            </span>
                            {/* What actually happened, so deciding whether to reopen a session
                            doesn't mean opening it. Indented past the status dot. Absent when the
                            title is already the message. */}
                            {subtitle ? (
                                <span className="min-w-0 truncate text-[13px] text-colorTextTertiary">
                                    {subtitle}
                                </span>
                            ) : null}
                        </span>
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
        // The band pins instead of a bordered card's own header — in a scrolling column the
        // sections then swap their pinned header the way the config panel's regions do.
        <PanelSection
            sticky
            variant="page"
            title={title}
            minHeightClassName={minHeightClassName}
            bodyClassName="flex grow flex-col px-2 pb-2 pt-1"
            titleExtra={
                waitingRowsAll.length > 0 ? (
                    <Link
                        href={scopedHref}
                        onClick={handleWaitingClick}
                        className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                    >
                        {waitingRowsAll.length} waiting
                    </Link>
                ) : null
            }
            extra={
                <Link href={scopedHref} onClick={handleViewAll} className={PANEL_ACTION_CLASS}>
                    View all
                    <ArrowRightIcon size={12} />
                </Link>
            }
        >
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
                            {/* Not a literal `false`: a card with no pinned group (Automation runs)
                                shows its pinned rows here, and hard-coding it left the pin icon
                                outlined after a click — the toggle looked like it did nothing. */}
                            {rows.map((row) => renderRow(row, pinnedSet.has(row.session_id)))}
                        </AnimatePresence>

                        {isEmpty ? (
                            <p className="m-0 flex grow items-center px-2 py-3 text-[13px] text-colorTextTertiary">
                                {emptyText}
                            </p>
                        ) : null}
                        {canShowMore ? (
                            <button
                                type="button"
                                onClick={handleShowMore}
                                className="cursor-pointer border-0 bg-transparent px-2 py-2 text-left text-xs text-colorPrimary"
                            >
                                Show more
                            </button>
                        ) : null}
                    </div>
                </MotionConfig>
            )}
        </PanelSection>
    )
}

export default SessionListCard
