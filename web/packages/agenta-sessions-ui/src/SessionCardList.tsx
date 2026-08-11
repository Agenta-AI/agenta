/**
 * THE session card list — the designed rows from the desktop Home card (status glyph + dot,
 * title, pending chip, agent name, activity, pin, context menu, subtitle), extracted so every
 * surface renders the same list with WORKING pinning instead of a lookalike. Data and grouping
 * come from `useSessionCardList` (waiting → pinned → recent) and `useSessionPins`; the host
 * supplies only its verbs: how a row opens, and its context-menu entries.
 */
import {useMemo, type ReactNode} from "react"

import {pendingGateLabel, type SessionRowVm} from "@agenta/sessions/row"
import {
    useSessionCardList,
    useSessionPins,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {timeAgo} from "@agenta/shared/utils"
import {SimpleTooltip, Skeleton} from "@agenta/ui/ui"
import {ArrowRightIcon, ChatCircleIcon, ClockIcon} from "@phosphor-icons/react"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "./assets/motion"
import {type SessionMenuEntry} from "./menu"
import {SessionAgentName} from "./SessionAgentName"
import {SessionPinButton} from "./SessionPinButton"
import {SessionRowContextMenu} from "./SessionRowContextMenu"

export interface SessionCardListProps extends UseSessionCardListArgs {
    emptyText: string
    /** Open a row (host routing: playground session, mobile chat route…). */
    onOpenRow: (vm: SessionRowVm) => void
    /** The host's context-menu verbs for a row; omit for no menu (e.g. touch surfaces). */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Hide the per-row agent name (an agent-scoped list restates its heading otherwise). */
    showAgent?: boolean
    /** Touch surfaces have no hover — keep the pin always visible there. */
    alwaysShowPin?: boolean
}

/** One row. The pin toggles in place; everything else is the host's verb. */
const Row = ({
    vm,
    origin,
    showAgent,
    alwaysShowPin,
    onOpenRow,
    onTogglePin,
    menuFor,
    onMenuSelect,
}: {
    vm: SessionRowVm
    origin?: string
    showAgent: boolean
    alwaysShowPin: boolean
    onOpenRow: (vm: SessionRowVm) => void
    onTogglePin: (id: string) => void
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
}) => {
    const entries = menuFor?.(vm)
    const row = (
        // A plain container, not a button: descendants of a button role are presentational, and
        // the pin nested inside one was keyboard-unreachable. The TITLE button is the open action.
        <div
            onClick={() => onOpenRow(vm)}
            className="group box-border flex w-full cursor-pointer items-start gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-transparent px-2 py-3 text-left hover:bg-colorFillQuaternary"
        >
            {/* A glyph for the KIND of row, with the status as a dot on its shoulder — the clock
                and the chat bubble separate automation runs from conversations without a heading. */}
            <SimpleTooltip title={vm.status.label}>
                <span className="relative mt-0.5 flex shrink-0 text-colorTextTertiary">
                    {origin ? <ClockIcon size={18} /> : <ChatCircleIcon size={18} />}
                    <span
                        className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-solid border-colorBgContainer ${vm.status.dotClassName} ${
                            vm.status.pulse ? "motion-safe:animate-pulse" : ""
                        }`}
                    />
                </span>
            </SimpleTooltip>

            <button
                type="button"
                onClick={(event) => {
                    event.stopPropagation()
                    onOpenRow(vm)
                }}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left"
            >
                <span className="w-full truncate text-sm text-colorText">{vm.title}</span>
                {/* What actually happened, so deciding whether to reopen a session doesn't mean
                    opening it. Absent when the title is already the message. */}
                {vm.subtitle ? (
                    <span className="w-full truncate text-[13px] text-colorTextTertiary">
                        {vm.subtitle}
                    </span>
                ) : null}
            </button>

            {/* h-5 = the title's line box, so the trailing controls centre on the TITLE rather
                than on a row whose height the subtitle decides. */}
            <div className="flex h-5 shrink-0 items-center gap-2">
                {/* Quiet chip: the amber urgency lives on the dot; this states WHAT is asked. */}
                {vm.status.chipLabel ? (
                    <span className="shrink-0 rounded bg-colorFillQuaternary px-1.5 py-0.5 text-xs leading-none text-colorTextSecondary">
                        {pendingGateLabel(vm.pending?.kinds)}
                    </span>
                ) : null}
                {showAgent ? (
                    <span className="w-24 shrink-0 truncate text-right">
                        <SessionAgentName agentId={vm.agentId} />
                    </span>
                ) : null}
                <span className="w-16 shrink-0 text-right text-xs text-colorTextTertiary">
                    {vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"}
                </span>
                <SessionPinButton
                    pinned={vm.isPinned}
                    onToggle={() => onTogglePin(vm.id)}
                    revealOnHover={!alwaysShowPin}
                />
            </div>
        </div>
    )

    return (
        <motion.div
            // Position only, never size: these rows live in a resizable pane, and a full `layout`
            // projects each row's box from a stale snapshot on every resize tick — children get
            // scale-corrected and this wrapper's `overflow-hidden` then CLIPS them at the old
            // width. Width has to come straight from CSS; the enter/exit height + gap collapse
            // below is what the animation is actually for.
            layout="position"
            variants={ROW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="overflow-hidden"
        >
            <SessionRowContextMenu entries={entries} onSelect={(key) => onMenuSelect?.(vm, key)}>
                {row}
            </SessionRowContextMenu>
        </motion.div>
    )
}

export const SessionCardList = ({
    emptyText,
    onOpenRow,
    menuFor,
    onMenuSelect,
    showAgent,
    alwaysShowPin = false,
    ...listArgs
}: SessionCardListProps) => {
    const list = useSessionCardList(listArgs)
    const {toggle: togglePin} = useSessionPins()
    // An agent-scoped list is already one agent's — naming it on every row restates the heading.
    const resolvedShowAgent = showAgent ?? !listArgs.agentId
    const flat = useMemo(
        () =>
            list.groups.flatMap((group): ReactNode[] => [
                ...(group.label
                    ? [
                          <motion.p
                              key={`${group.key}-heading`}
                              layout
                              variants={ROW_VARIANTS}
                              initial="initial"
                              animate="animate"
                              exit="exit"
                              className="m-0 overflow-hidden px-2 pt-1 text-xs uppercase tracking-wide text-colorTextTertiary"
                          >
                              {group.label}
                          </motion.p>,
                      ]
                    : []),
                ...group.rows.map((vm) => (
                    <Row
                        key={vm.id}
                        vm={vm}
                        origin={listArgs.origin}
                        showAgent={resolvedShowAgent}
                        alwaysShowPin={alwaysShowPin}
                        onOpenRow={onOpenRow}
                        onTogglePin={togglePin}
                        menuFor={menuFor}
                        onMenuSelect={onMenuSelect}
                    />
                )),
            ]),
        [
            list.groups,
            listArgs.origin,
            resolvedShowAgent,
            alwaysShowPin,
            onOpenRow,
            togglePin,
            menuFor,
            onMenuSelect,
        ],
    )

    if (list.isPending) {
        return (
            <div className="flex flex-col gap-2 px-2 py-2">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-6 w-full" />
                ))}
            </div>
        )
    }

    return (
        <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
            <div className="flex grow flex-col">
                {/* Flat children: AnimatePresence tracks direct keyed children, so the headings
                    and rows must not hide inside fragments or exits are lost. */}
                <AnimatePresence initial={false}>{flat}</AnimatePresence>
                {list.isEmpty ? (
                    <p className="m-0 flex grow items-center px-2 py-3 text-[13px] text-colorTextTertiary">
                        {emptyText}
                    </p>
                ) : null}
                {list.canShowMore ? (
                    <button
                        type="button"
                        onClick={list.showMore}
                        className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-2 py-2 text-left text-xs text-colorPrimary"
                    >
                        Show more
                        <ArrowRightIcon size={12} />
                    </button>
                ) : null}
            </div>
        </MotionConfig>
    )
}
