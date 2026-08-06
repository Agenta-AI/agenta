import {useCallback, useMemo} from "react"

import {pendingGateLabel, type SessionRowVm} from "@agenta/sessions/row"
import {applySessionScopeAtom, useSessionCardList, useSessionPins} from "@agenta/sessions/state"
import {SessionAgentName} from "@agenta/sessions-ui"
import {PANEL_ACTION_CLASS, PanelSection} from "@agenta/ui/components/presentational"
import {ArrowRightIcon, ChatCircleIcon, ClockIcon, PushPinIcon} from "@phosphor-icons/react"
import {Dropdown, Skeleton, Tooltip} from "antd"
import {useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"
import Link from "next/link"

import {ROW_VARIANTS, SESSION_SPRING} from "@/oss/components/AgentChatSlice/assets/sessionMotion"
import {useOpenAgentSession} from "@/oss/components/AgentChatSlice/hooks/useOpenAgentSession"
import {useSessionActions} from "@/oss/components/AgentChatSlice/hooks/useSessionActions"
import {timeAgo} from "@/oss/components/AgentChatSlice/state/sessions"
import useURL from "@/oss/hooks/useURL"

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
 * so the two surfaces stay one thing rather than two that look alike. The grouping (waiting →
 * pinned → recent), the card cap, and "show more" are `useSessionCardList`'s decisions; this
 * card renders the groups it is handed and wires the app-side actions.
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
    const list = useSessionCardList({agentId, origin, limit, withPinned})
    const {toggle: togglePin} = useSessionPins()
    const applyScope = useSetAtom(applySessionScopeAtom)
    const openSession = useOpenAgentSession()
    const actions = useSessionActions()
    const {projectURL} = useURL()

    const handleOpen = useCallback(
        (vm: SessionRowVm) => {
            if (vm.agentId)
                openSession({
                    appId: vm.agentId,
                    sessionId: vm.id,
                    title: vm.stream.name?.trim() || undefined,
                })
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
    const handleWaitingClick = useCallback(() => {
        applyScope({...linkScope, status: "waiting"})
    }, [applyScope, linkScope])

    const renderRow = (vm: SessionRowVm) => {
        const actionTarget = {
            sessionId: vm.id,
            appId: vm.agentId,
            name: vm.stream.name,
            archived: Boolean(vm.stream.archived_at),
        }

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
                <Dropdown
                    trigger={["contextMenu"]}
                    menu={{
                        items: actions.menuItems(actionTarget, {onOpen: () => handleOpen(vm)}),
                        onClick: actions.onMenuClick(actionTarget, {onOpen: () => handleOpen(vm)}),
                    }}
                >
                    <button
                        type="button"
                        onClick={() => handleOpen(vm)}
                        className="group box-border flex w-full cursor-pointer items-start gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-3 text-left hover:bg-colorFillQuaternary"
                    >
                        {/* A glyph for the KIND of row, with the status as a dot on its shoulder.
                            Two lists in the same column read as one long list when every row leads
                            with the same dot; the clock and the chat bubble separate them without
                            a heading. */}
                        <Tooltip title={vm.status.label}>
                            <span className="relative mt-0.5 flex shrink-0 text-colorTextTertiary">
                                {origin ? <ClockIcon size={18} /> : <ChatCircleIcon size={18} />}
                                <span
                                    className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-solid border-colorBgContainer ${vm.status.dotClassName} ${
                                        vm.status.pulse ? "motion-safe:animate-pulse" : ""
                                    }`}
                                />
                            </span>
                        </Tooltip>
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="flex w-full items-center gap-2">
                                <span className="min-w-0 flex-1 truncate text-sm text-colorText">
                                    {vm.title}
                                </span>
                                {/* Inside a "Waiting on you" group the urgency is already stated, so the
                            chip spends itself on WHAT is being asked and stays visually quiet —
                            the amber lives on the dot and the header badge. The fill is the
                            faintest available: a solid pill beside a title reads as a button,
                            and this chip is a label. */}
                                {vm.status.chipLabel ? (
                                    <span className="shrink-0 rounded bg-colorFillQuaternary px-1.5 py-0.5 text-xs leading-none text-colorTextSecondary">
                                        {pendingGateLabel(vm.pending?.kinds)}
                                    </span>
                                ) : null}
                                {/* An agent-scoped card is already one agent's, so naming it on every row
                            spends a third of the row width restating the heading. */}
                                {agentId ? null : (
                                    <span className="w-24 shrink-0 truncate text-right">
                                        <SessionAgentName agentId={vm.agentId} />
                                    </span>
                                )}
                                <span className="w-16 shrink-0 text-right text-xs text-colorTextTertiary">
                                    {vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"}
                                </span>
                                <Tooltip title={vm.isPinned ? "Unpin" : "Pin"}>
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        aria-label={vm.isPinned ? "Unpin session" : "Pin session"}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            togglePin(vm.id)
                                        }}
                                        className={`shrink-0 text-colorTextTertiary ${
                                            vm.isPinned ? "" : "opacity-0 group-hover:opacity-100"
                                        }`}
                                    >
                                        <PushPinIcon
                                            size={14}
                                            weight={vm.isPinned ? "fill" : "regular"}
                                        />
                                    </span>
                                </Tooltip>
                            </span>
                            {/* What actually happened, so deciding whether to reopen a session
                            doesn't mean opening it. Indented past the status dot. Absent when the
                            title is already the message. */}
                            {vm.subtitle ? (
                                <span className="min-w-0 truncate text-[13px] text-colorTextTertiary">
                                    {vm.subtitle}
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
                list.waitingTotal > 0 ? (
                    <Link
                        href={scopedHref}
                        onClick={handleWaitingClick}
                        className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText"
                    >
                        {list.waitingTotal} waiting
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
            {list.isPending ? (
                <Skeleton active paragraph={{rows: 4}} title={false} />
            ) : (
                <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
                    {/* `grow`, NOT `flex-1`: `flex-1` sets `flex-basis: 0`, so this card sized
                        itself as though the list were empty and every row past the min-height
                        floor spilled out of the bottom border. `grow` keeps the content's own
                        height and still fills the floor's leftover, which is all the empty
                        state needed it for. */}
                    <div className="flex grow flex-col">
                        {/* Flat children: AnimatePresence tracks direct keyed children, so the
                            headings and rows must not hide inside fragments or exits are lost. */}
                        <AnimatePresence initial={false}>
                            {list.groups.flatMap((group) => [
                                ...(group.label
                                    ? [groupHeading(`${group.key}-heading`, group.label)]
                                    : []),
                                ...group.rows.map(renderRow),
                            ])}
                        </AnimatePresence>

                        {list.isEmpty ? (
                            <p className="m-0 flex grow items-center px-2 py-3 text-[13px] text-colorTextTertiary">
                                {emptyText}
                            </p>
                        ) : null}
                        {list.canShowMore ? (
                            <button
                                type="button"
                                onClick={list.showMore}
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
