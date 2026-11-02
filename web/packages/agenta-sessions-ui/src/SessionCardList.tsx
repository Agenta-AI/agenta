/**
 * THE session card list — the designed rows from the desktop Home card (status glyph + dot,
 * title, pending chip, agent name, activity, pin, context menu, subtitle), extracted so every
 * surface renders the same list with WORKING pinning instead of a lookalike. Data and grouping
 * come from `useSessionCardList` (waiting → pinned → recent) and `useSessionPins`; the host
 * supplies only its verbs: how a row opens, and its context-menu entries.
 */
import {useCallback, useMemo, type ReactNode} from "react"

import {pendingGateLabel, type SessionRowVm} from "@agenta/sessions/row"
import {
    useSessionCardList,
    useSessionPins,
    type UseSessionCardListArgs,
} from "@agenta/sessions/state"
import {timeAgo} from "@agenta/shared/utils"
import {SimpleTooltip, SkeletonBlock} from "@agenta/ui/ui"
import {
    ArrowRightIcon,
    ChatCircleIcon,
    CircleIcon,
    CircleNotchIcon,
    ClockIcon,
    LightningIcon,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "./assets/motion"
import InlineRenameInput from "./InlineRenameInput"
import {type SessionMenuEntry} from "./menu"
import {SessionAgentName} from "./SessionAgentName"
import {SessionAutomationKind} from "./SessionAutomationKind"
import {SessionPinButton} from "./SessionPinButton"
import {SessionRowContextMenu} from "./SessionRowContextMenu"
import {useInlineRename} from "./useInlineRename"

export interface SessionCardListProps extends UseSessionCardListArgs {
    emptyText: string
    /** Open a row (host routing: playground session, mobile chat route…). */
    onOpenRow: (vm: SessionRowVm) => void
    /** The host's context-menu verbs for a row; omit for no menu (e.g. touch surfaces). */
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    /**
     * Persists a rename. Given this, a row renames IN PLACE from its context menu — the same edit
     * `SessionsListView` offers. Without it the "rename" key falls through to `onMenuSelect`,
     * where a host that cannot rename leaves the entry dead.
     */
    onRenameRow?: (vm: SessionRowVm, name: string) => Promise<boolean>
    /** Hide the per-row agent name (an agent-scoped list restates its heading otherwise). */
    showAgent?: boolean
    /** Touch surfaces have no hover — keep the pin always visible there. */
    alwaysShowPin?: boolean
    /**
     * `card` is the designed Home row (glyph, subtitle, agent name). `compact` is the nav rail's
     * one-line row — status glyph, title, time — for a popover that should read like the sidebar.
     */
    density?: "card" | "compact"
    /** The row that is on screen — painted as the rail paints its selected entry. */
    activeRowId?: string
}

/** Title widths for the compact placeholder rows — uneven, so they read as names, not a bar chart. */
const COMPACT_SKELETON_TITLE_WIDTHS = ["w-[58%]", "w-[42%]", "w-[66%]", "w-[36%]", "w-[50%]"]

/**
 * The nav rail's status glyph, so a compact row reads exactly as the same session does in the
 * sidebar: a turn in flight spins, an automation is a bolt, a chat is a dot; fill means live,
 * amber means it is waiting on you.
 */
const CompactStatusGlyph = ({vm}: {vm: SessionRowVm}) => {
    const {status} = vm.status
    if (status === "running") return <CircleNotchIcon size={12} className="animate-spin" />
    const live = status === "waiting" || status === "alive"
    const amber = status === "waiting" ? "text-[var(--ag-run-status-warning)]" : undefined
    if (vm.automation)
        return <LightningIcon size={12} weight={live ? "fill" : "regular"} className={amber} />
    return <CircleIcon size={10} weight={live ? "fill" : "regular"} className={amber} />
}

/** One row, and the owner of its rename state. The pin toggles in place; the rest is the host's. */
const Row = ({
    vm,
    origin,
    showAgent,
    alwaysShowPin,
    compact,
    active,
    onOpenRow,
    onTogglePin,
    menuFor,
    onMenuSelect,
    onRenameRow,
}: {
    vm: SessionRowVm
    origin?: string
    showAgent: boolean
    alwaysShowPin: boolean
    compact: boolean
    active: boolean
    onOpenRow: (vm: SessionRowVm) => void
    onTogglePin: (id: string) => void
    menuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onMenuSelect?: (vm: SessionRowVm, key: string) => void
    onRenameRow?: (vm: SessionRowVm, name: string) => Promise<boolean>
}) => {
    const entries = menuFor?.(vm)
    // The phone hides the pin because the menu carries Pin/Unpin. A host that passes no menu, or
    // one without that entry, would otherwise leave the row with no way to pin at all.
    const menuHasPin = Boolean(entries?.some((entry) => "key" in entry && entry.key === "pin"))
    const onRename = useMemo(
        () => (onRenameRow ? (name: string) => onRenameRow(vm, name) : undefined),
        [onRenameRow, vm],
    )
    const rename = useInlineRename({current: vm.title, onCommit: onRename ?? (async () => false)})

    const onSelect = useCallback(
        (key: string) => {
            // Deferred, not run here: the editor must not mount inside the menu's focus trap.
            // See `SessionRowContextMenu`.
            if (key === "rename" && onRename) return () => rename.start()
            onMenuSelect?.(vm, key)
        },
        [onMenuSelect, onRename, rename, vm],
    )

    const row = compact ? (
        // The rail's row, restated: one line, 28px, the glyph on the left and the time on the
        // right. The whole row opens; the title is still the button so the keyboard reaches it.
        <div
            onClick={() => onOpenRow(vm)}
            className={clsx(
                "group relative box-border mb-1 flex h-7 w-full cursor-pointer select-none items-center gap-[10px] rounded-md px-3 text-sm leading-7",
                // A fill, not the rail's inset ring: on the popover's white the ring read as a
                // drawn box. Same step the selected tab chip wears, so the two agree.
                active
                    ? "bg-colorFillTertiary font-medium text-colorText"
                    : "text-colorText hover:bg-colorFillQuaternary",
            )}
        >
            <SimpleTooltip title={vm.status.label}>
                <span className="flex shrink-0 items-center text-colorTextTertiary">
                    <CompactStatusGlyph vm={vm} />
                </span>
            </SimpleTooltip>
            {rename.renaming ? (
                <span
                    className="flex min-w-0 flex-1 items-center"
                    onClick={(event) => event.stopPropagation()}
                >
                    <InlineRenameInput
                        rename={rename}
                        className="h-6 w-full min-w-0 rounded border border-solid border-colorBorder bg-colorBgContainer px-1 text-sm leading-6 text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                    />
                </span>
            ) : (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation()
                        onOpenRow(vm)
                    }}
                    className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-inherit [font-family:inherit] [font-weight:inherit]"
                >
                    <span className="min-w-0 truncate" title={vm.title}>
                        {vm.title}
                    </span>
                    {vm.automation ? <SessionAutomationKind kind={vm.automation.kind} /> : null}
                </button>
            )}
            {/* Beside the name, not in the gutter: the time keeps the right edge and the pin
                surfaces on hover next to what it pins. */}
            <SessionPinButton
                pinned={vm.isPinned}
                onToggle={() => onTogglePin(vm.id)}
                revealOnHover={!alwaysShowPin}
                tooltip={false}
                className={clsx("flex", menuHasPin && "hidden sm:flex")}
            />
            {/* No gate chip: the amber dot and the group heading already say it is waiting. */}
            <span className="ml-auto shrink-0 text-xs leading-none text-colorTextTertiary">
                {vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"}
            </span>
        </div>
    ) : (
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

            {/* The editor REPLACES the open button rather than sitting inside it: an input is not
                allowed inside a button, and a click in it would otherwise open the session. */}
            {rename.renaming ? (
                <span
                    className="flex min-w-0 flex-1 items-center"
                    onClick={(event) => event.stopPropagation()}
                >
                    <InlineRenameInput
                        rename={rename}
                        className="h-6 w-full min-w-0 rounded border border-solid border-colorBorder bg-colorBgContainer px-1 text-sm leading-6 text-colorText outline-none [font-family:inherit] focus:border-colorPrimary"
                    />
                </span>
            ) : (
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation()
                        onOpenRow(vm)
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1 border-0 bg-transparent p-0 text-left"
                >
                    <span className="flex w-full min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-colorText">
                            {vm.title}
                        </span>
                        {/* An automation row IS its schedule/subscription — the kind is what tells it
                        apart from a conversation you started (#5927). Matches SessionRow. */}
                        {vm.automation ? <SessionAutomationKind kind={vm.automation.kind} /> : null}
                    </span>
                    {/* What actually happened, so deciding whether to reopen a session doesn't mean
                    opening it. Absent when the title is already the message. */}
                    {vm.subtitle ? (
                        <span className="w-full truncate text-[13px] text-colorTextTertiary">
                            {vm.subtitle}
                        </span>
                    ) : null}
                </button>
            )}

            {/* h-5 = the title's line box, so the trailing controls centre on the TITLE rather
                than on a row whose height the subtitle decides. */}
            <div className="flex h-5 shrink-0 items-center gap-1 sm:gap-2">
                {/* Quiet chip: the amber urgency lives on the dot; this states WHAT is asked. */}
                {vm.status.chipLabel ? (
                    <span className="shrink-0 rounded bg-colorFillQuaternary px-1.5 py-0.5 text-xs leading-none text-colorTextSecondary">
                        {pendingGateLabel(vm.pending?.kinds)}
                    </span>
                ) : null}
                {/* Hidden on a phone: with the chip, time and pin all shrink-0, this 96px column
                    starved the title to 0px. The agent overview already proves the row reads fine
                    without it — it passes showAgent={false}. */}
                {showAgent ? (
                    <span className="hidden w-24 shrink-0 truncate text-right sm:block">
                        <SessionAgentName agentId={vm.agentId} />
                    </span>
                ) : null}
                <span className="w-16 shrink-0 text-right text-xs text-colorTextTertiary">
                    {vm.activityAt ? timeAgo(Date.parse(vm.activityAt)) : "—"}
                </span>
                {/* Phone-hidden, like SessionRow, but only where the menu can stand in for it. */}
                <SessionPinButton
                    pinned={vm.isPinned}
                    onToggle={() => onTogglePin(vm.id)}
                    revealOnHover={!alwaysShowPin}
                    className={menuHasPin ? "hidden sm:block" : undefined}
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
            <SessionRowContextMenu entries={entries} onSelect={onSelect}>
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
    onRenameRow,
    showAgent,
    alwaysShowPin = false,
    density = "card",
    activeRowId,
    ...listArgs
}: SessionCardListProps) => {
    const compact = density === "compact"
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
                              // Sticky so the group a row belongs to stays named while you scroll
                              // past it. `bg-inherit` rather than a fixed token: this list renders
                              // on the popover's elevated surface, the chat pane's raised one and
                              // the page's plain one, and a hardcoded colour would band on two of
                              // the three. Inert wherever the container does not scroll.
                              // Compact keeps the rail's sentence-case headings; the card
                              // variant keeps its small caps.
                              className={clsx(
                                  "bg-inherit sticky z-10 m-0 overflow-hidden pb-1 pt-1 text-xs text-colorTextTertiary",
                                  compact ? "px-3" : "px-2 uppercase tracking-wide",
                              )}
                              // Pins BELOW the host's own sticky header rather than on top of it:
                              // two sticky elements both at `top-0` in one scroller pin to the
                              // same line and simply overlap. A host with a header of its own
                              // publishes its MEASURED height as `--ag-panel-header-h`; the 0px
                              // fallback is the bare top, for a host without one (the popover,
                              // the full sessions list).
                              style={{top: "var(--ag-panel-header-h, 0px)"}}
                          >
                              {group.label}
                          </motion.p>,
                      ]
                    : []),
                ...group.rows.map((vm) => (
                    <Row
                        key={vm.id}
                        vm={vm}
                        origin={listArgs.policy?.origin === "trigger-only" ? "trigger" : undefined}
                        showAgent={resolvedShowAgent}
                        alwaysShowPin={alwaysShowPin}
                        compact={compact}
                        active={vm.id === activeRowId}
                        onOpenRow={onOpenRow}
                        onTogglePin={togglePin}
                        menuFor={menuFor}
                        onMenuSelect={onMenuSelect}
                        onRenameRow={onRenameRow}
                    />
                )),
            ]),
        [
            list.groups,
            listArgs.policy?.origin === "trigger-only" ? "trigger" : undefined,
            resolvedShowAgent,
            alwaysShowPin,
            compact,
            activeRowId,
            onOpenRow,
            togglePin,
            menuFor,
            onMenuSelect,
            onRenameRow,
        ],
    )

    if (list.isPending) {
        // Compact: the rail row's own geometry — 28px, glyph, title, time — so the rows land on
        // the placeholder without a shift.
        if (compact) {
            return (
                <div className="flex flex-col" aria-busy>
                    {COMPACT_SKELETON_TITLE_WIDTHS.map((width) => (
                        <div key={width} className="mb-1 flex h-7 items-center gap-[10px] px-3">
                            <SkeletonBlock active shape="circle" className="size-2.5 shrink-0" />
                            <SkeletonBlock active className={clsx("h-3", width)} />
                            <SkeletonBlock active className="ml-auto h-3 w-12 shrink-0" />
                        </div>
                    ))}
                </div>
            )
        }
        return (
            <div className="flex flex-col gap-2 px-2 py-2">
                {[0, 1, 2, 3].map((i) => (
                    // SkeletonBlock (one bar), NOT the Skeleton COMPOSITE: that renders antd's
                    // title + 3 paragraph rows at 38/100/100/61% with UA margins, and the `h-6`
                    // lands on its flex root, so ~100px of bars were crammed into 24px and
                    // overlapped. Four of them read as a staircase of half-drawn bars.
                    <SkeletonBlock active key={i} className="h-6 w-full" />
                ))}
            </div>
        )
    }

    return (
        <MotionConfig transition={SESSION_SPRING} reducedMotion="user">
            {/* `bg-inherit` so the sticky group headings below have an opaque surface to inherit:
                without it they resolve to transparent and rows scroll visibly THROUGH them. The
                host states the real colour on the scroll container; this only passes it down. */}
            <div className="bg-inherit flex grow flex-col">
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
