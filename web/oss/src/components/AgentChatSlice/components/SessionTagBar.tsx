import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {useSessionPins} from "@agenta/sessions/state"
import {
    SessionRowContextMenu,
    SessionTab,
    SessionTabDragItem,
    SessionTabStrip,
} from "@agenta/sessions-ui"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowLineRight, PencilSimple, X, XSquare} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig} from "motion/react"

import {SESSION_SPRING, TAG_VARIANTS} from "../assets/sessionMotion"
import {useInlineRenameRequest} from "../hooks/useInlineRenameRequest"
import {useSessionActions, type SessionMenuItem} from "../hooks/useSessionActions"
import {type SessionDotStatus, sessionDotStatusAtomFamily} from "../state/liveness"
import {useChatScopeKey} from "../state/scope"
import {
    type AgentChatSession,
    reorderSessionsAtomFamily,
    sessionFirstUserTextAtomFamily,
} from "../state/sessions"

import SessionTabLabel, {type SessionTabLabelHandle} from "./SessionTabLabel"

/** `attention` states need the user (approval / input) or flag a failure — their semantic colour
 * outranks the active tab's clean white dot, so it's never masked on the session you're viewing.
 * `alive` is the cross-device/warm signal: a backend sandbox that's live but idle here — a dim,
 * non-pulsing accent so it reads as "resumes instantly" without competing with a live `running`. */
const STATUS_META: Record<
    SessionDotStatus,
    {dot: string; pulse: boolean; attention: boolean; title: string}
> = {
    running: {dot: "bg-colorInfo", pulse: true, attention: false, title: "Responding…"},
    awaiting: {dot: "bg-colorWarning", pulse: true, attention: true, title: "Needs your input"},
    error: {dot: "bg-colorError", pulse: false, attention: true, title: "Last run failed"},
    alive: {dot: "bg-colorInfoBorder", pulse: false, attention: false, title: "Session is live"},
    idle: {dot: "bg-colorTextQuaternary", pulse: false, attention: false, title: "Idle"},
}

/** A session's run-state dot. Subscribes to just that session's effective-status atom (local run
 * state, or backend liveness when idle here) so a streaming conversation repaints only its own dot,
 * never the whole bar. */
export const SessionStatusDot = ({
    sessionId,
    active = false,
}: {
    sessionId: string
    active?: boolean
}) => {
    const status = useAtomValue(sessionDotStatusAtomFamily(sessionId))
    const meta = STATUS_META[status]
    // Whiten the dot to match the active tab's white text ONLY when the session is idle. Any live
    // state — running (streaming a response), awaiting (needs you), error — keeps its semantic
    // colour even on the active tab, so its signal survives on the session you're looking at.
    const dotClassName = clsx(meta.dot, active && status === "idle" && "dark:bg-white")
    return (
        <span
            className={clsx(
                "relative flex h-1.5 w-1.5 shrink-0",
                // A halo ring makes an attention dot read as a badge even at 6px, so it stands out
                // across a row of running/idle tabs without enlarging the dot itself.
                meta.attention && "rounded-full ring-2 ring-offset-0",
                status === "awaiting" && "ring-colorWarningBorder",
                status === "error" && "ring-colorErrorBorder",
            )}
            title={meta.title}
        >
            {meta.pulse && (
                <span
                    className={clsx(
                        "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
                        dotClassName,
                    )}
                />
            )}
            <span className={clsx("relative inline-flex h-1.5 w-1.5 rounded-full", dotClassName)} />
        </span>
    )
}

// Static icon elements — see the note in SessionRail: an inline `<Icon />` is a new prop each render.
const PENCIL_ICON = <PencilSimple size={12} />
const X_ICON = <X size={12} />

interface SessionTagProps {
    session: AgentChatSession
    index: number
    active: boolean
    closable: boolean
    /** True when this session already existed at the bar's first mount (reload restore) — an
     * activation here jumps instantly; a session added afterwards keeps the smooth scroll. */
    presentAtMount: boolean
    /** Renders a hairline divider after this tag — every session but the last. Borderless chips
     * need it to read as separate items. */
    showDivider: boolean
    /** Shared project-wide pin — shows a pin glyph, and why pinned chips lead the strip. */
    pinned: boolean
    // Id-taking so the bar can forward its own stable setters straight through; per-chip closures
    // would change identity every render and drag each chip's Tooltip/Button subtree with them.
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onRename: (id: string, title: string) => void
    /** Right-click actions, from the shared `useSessionActions` set. */
    menu: {items: SessionMenuItem[]; onClick: (info: {key: string}) => void}
}

/** One session chip: status dot + truncated label (double-click or pencil to rename) + hover
 * actions. The rename/close buttons float OVER the label's tail (Chrome-tab style) instead of
 * reserving in-flow width, so revealing them on hover never reflows the label or shifts pixels. */
const SessionTag = memo(function SessionTag({
    session,
    index,
    active,
    closable,
    presentAtMount,
    showDivider,
    pinned,
    onSelect,
    onClose,
    onRename,
    menu,
}: SessionTagProps) {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const label = session.title || text || `Chat ${index + 1}`
    const tabRef = useRef<HTMLDivElement>(null)
    const labelRef = useRef<SessionTabLabelHandle>(null)
    useInlineRenameRequest(session.id, labelRef, "strip")
    // Hide the hover actions while the inline rename input owns the row. The chip itself owns the
    // hover/focus state that decides whether they're mounted at all (see SessionTab).
    const [renaming, setRenaming] = useState(false)
    const sessionId = session.id
    const handleSelect = useCallback(() => onSelect(sessionId), [onSelect, sessionId])
    const handleRename = useCallback(
        (title: string) => onRename(sessionId, title),
        [onRename, sessionId],
    )
    const startRename = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        labelRef.current?.startEditing()
    }, [])
    const handleClose = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            onClose(sessionId)
        },
        [onClose, sessionId],
    )
    // Keep the active tab visible. Jump INSTANTLY only on the bar's initial reveal of a session that
    // was already present at mount (reload restoring a far-away active tab) — the strip's scroll-smooth
    // would otherwise play a long scroll across the whole strip. A session added later, or any user
    // switch, keeps the CSS smooth nudge (so a freshly-created tab still glides into view).
    const mountedRef = useRef(false)
    useEffect(() => {
        // Reveal on tab switch / reload restore. For a newly-added tab this lands short (mount
        // width is ~0), but onUpdate below tracks it the rest of the way — this stays as the
        // reduced-motion fallback (when no enter-animation frames fire).
        if (active) {
            tabRef.current?.scrollIntoView({
                block: "nearest",
                inline: "nearest",
                behavior: presentAtMount && !mountedRef.current ? "instant" : undefined,
            })
        }
        mountedRef.current = true
    }, [active])
    return (
        // Wrapper collapses its width + gap margin on enter/exit so neighbours close up with no snap,
        // and doubles as the tab's drag slot (arranging tabs writes the scope's open-ids order).
        <SessionTabDragItem
            id={session.id}
            ref={tabRef}
            variants={TAG_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SESSION_SPRING}
            onUpdate={() => {
                // Track a newly-added active tab into view AS it grows (width enters from ~0px), so
                // the reveal starts on the first frame instead of lagging until the spring settles.
                if (!(active && !presentAtMount)) return
                const tab = tabRef.current
                const strip = tab?.parentElement
                if (!tab || !strip) return
                // Only nudge when the growing tab pokes past a visible edge (skip the per-frame call once revealed).
                const t = tab.getBoundingClientRect()
                const s = strip.getBoundingClientRect()
                if (t.right > s.right || t.left < s.left) {
                    tab.scrollIntoView({block: "nearest", inline: "nearest", behavior: "instant"})
                }
            }}
            className="flex shrink-0 items-center overflow-hidden"
        >
            <SessionRowContextMenu entries={menu.items} onSelect={(key) => menu.onClick({key})}>
                <SessionTab
                    active={active}
                    pinned={pinned}
                    onSelect={handleSelect}
                    statusDot={<SessionStatusDot sessionId={session.id} active={active} />}
                    label={
                        <SessionTabLabel
                            ref={labelRef}
                            label={label}
                            onRename={handleRename}
                            onEditingChange={setRenaming}
                            // No `truncate`: the chip masks the tail into its own fill.
                            className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap"
                        />
                    }
                    renderActions={() =>
                        renaming ? null : (
                            <>
                                <SimpleTooltip title="Rename session">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Rename session"
                                        onClick={startRename}
                                        className="h-5 w-5 shrink-0 p-0"
                                    >
                                        {PENCIL_ICON}
                                    </Button>
                                </SimpleTooltip>
                                {closable && (
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Close session"
                                        onClick={handleClose}
                                        className="h-5 w-5 shrink-0 p-0"
                                    >
                                        {X_ICON}
                                    </Button>
                                )}
                            </>
                        )
                    }
                />
            </SessionRowContextMenu>
            {/* Travels INSIDE the collapsing wrapper, so it leaves with a removed session
                instead of stranding a line. */}
            {showDivider && (
                <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-colorBorderSecondary" />
            )}
        </SessionTabDragItem>
    )
})

export interface SessionTagBarProps {
    sessions: AgentChatSession[]
    activeId?: string
    onSelect: (id: string) => void
    onAdd: () => void
    /** Disable the New session (+) button (e.g. onboarding, until the founding run settles). */
    addDisabled?: boolean
    onClose: (id: string) => void
    /** Bulk closes from a tab's context menu ("Close other tabs" / "Close tabs to the right"). */
    onCloseMany?: (ids: string[]) => void
    onRename: (id: string, title: string) => void
    /** Right-aligned extras (e.g. the session-history menu). */
    extra?: React.ReactNode
    /** Left-aligned extra (the config-panel reveal control) — rendered at the strip's leading
     * edge, the spot the config panel disappeared from, so a collapse/reveal round-trip returns
     * the eye to where it left off instead of hunting the far side of the bar. */
    leftExtra?: React.ReactNode
    /** Show the inline session pills + add button. Off in full-screen mode, where the vertical
     * SessionRail owns the session list and this bar keeps only the right-aligned extras. */
    showSessions?: boolean
}

/**
 * Tag-style session bar for the agent playground. Replaces antd's editable-card tab strip via
 * `renderTabBar`, so the panes (and their live `useChat` streams) keep antd's mount semantics
 * while the bar reads as a row of chips. The 48px height + bottom border aligns its bottom edge
 * with the config panel header on the left.
 */
const SessionTagBar = ({
    sessions,
    activeId,
    onSelect,
    onAdd,
    addDisabled = false,
    onClose,
    onCloseMany,
    onRename,
    extra,
    leftExtra,
    showSessions = true,
}: SessionTagBarProps) => {
    const closable = sessions.length > 1
    // Right-click a chip for the same verbs the sessions list offers. Scope IS the owning agent,
    // so the local tab cache and the server stay in step.
    const scope = useChatScopeKey()
    const reorderSessions = useSetAtom(reorderSessionsAtomFamily(scope))
    const tabIds = useMemo(() => sessions.map((session) => session.id), [sessions])
    const {isPinned} = useSessionPins()
    const {menuItems, onMenuClick} = useSessionActions()
    const menuFor = useCallback(
        (session: AgentChatSession) => {
            const target = {
                sessionId: session.id,
                appId: scope,
                name: session.title,
                archived: Boolean(session.archived),
            }
            // Chrome's bulk closes. Pinned tabs survive "close others", as they do in a browser —
            // and since pins lead the strip they are never "to the right" of anything anyway.
            const index = sessions.findIndex((s) => s.id === session.id)
            const others = sessions
                .filter((s) => s.id !== session.id && !isPinned(s.id))
                .map((s) => s.id)
            const toRight = sessions
                .slice(index + 1)
                .filter((s) => !isPinned(s.id))
                .map((s) => s.id)
            const shared = onMenuClick(target)
            return {
                items: [
                    ...menuItems(target),
                    {type: "divider" as const},
                    {
                        key: "close",
                        label: "Close",
                        icon: <X size={14} />,
                        disabled: sessions.length <= 1,
                    },
                    {
                        key: "close-others",
                        label: "Close other tabs",
                        icon: <XSquare size={14} />,
                        disabled: others.length === 0,
                    },
                    {
                        key: "close-right",
                        label: "Close tabs to the right",
                        icon: <ArrowLineRight size={14} />,
                        disabled: toRight.length === 0,
                    },
                ],
                onClick: ({key}: {key: string}) => {
                    if (key === "close") return onClose(session.id)
                    if (key === "close-others") return onCloseMany?.(others)
                    if (key === "close-right") return onCloseMany?.(toRight)
                    shared({key})
                },
            }
        },
        [isPinned, menuItems, onClose, onCloseMany, onMenuClick, scope, sessions],
    )
    // Session ids present when the bar first mounted. Seeded once; NOT topped up, so an id that
    // appears later reads as "added after mount" and scrolls smoothly (see SessionTag).
    const presentAtMountRef = useRef<Set<string>>(new Set())
    const seededRef = useRef(false)
    if (!seededRef.current) {
        seededRef.current = true
        sessions.forEach((s) => presentAtMountRef.current.add(s.id))
    }
    return (
        <MotionConfig reducedMotion="user">
            <SessionTabStrip
                showTabs={showSessions}
                onAdd={onAdd}
                addDisabled={addDisabled}
                addTooltip={
                    addDisabled ? "Available after your agent's first response" : "New session"
                }
                extra={extra}
                leadingExtra={leftExtra}
                remeasureKey={sessions}
                reorder={{ids: tabIds, onReorder: reorderSessions}}
            >
                <AnimatePresence initial={false}>
                    {sessions.map((session, index) => (
                        <SessionTag
                            key={session.id}
                            session={session}
                            index={index}
                            active={session.id === activeId}
                            closable={closable}
                            presentAtMount={presentAtMountRef.current.has(session.id)}
                            showDivider={index < sessions.length - 1}
                            pinned={isPinned(session.id)}
                            onSelect={onSelect}
                            onClose={onClose}
                            onRename={onRename}
                            menu={menuFor(session)}
                        />
                    ))}
                </AnimatePresence>
            </SessionTabStrip>
        </MotionConfig>
    )
}

export default SessionTagBar
