import {memo, useCallback, useEffect, useRef, useState} from "react"

import {PencilSimple, Plus, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {SESSION_SPRING, TAG_VARIANTS} from "../assets/sessionMotion"
import {type SessionDotStatus, sessionDotStatusAtomFamily} from "../state/liveness"
import {type AgentChatSession, sessionFirstUserTextAtomFamily} from "../state/sessions"

import SessionTabLabel, {type SessionTabLabelHandle} from "./SessionTabLabel"

/** Slight left/right edge fade so tabs dissolve into the strip edges instead of a hard cut when
 * they overflow. Applied per-side ONLY where content is actually clipped (scrolled past) — a strip
 * that fits (e.g. a single tab) gets no fade, so its lone item isn't dimmed at the edges. */
const EDGE_FADE_PX = 20
const fadeMask = (left: boolean, right: boolean): string => {
    const start = left ? `transparent 0, #000 ${EDGE_FADE_PX}px` : "#000 0"
    const end = right ? `#000 calc(100% - ${EDGE_FADE_PX}px), transparent 100%` : "#000 100%"
    return `linear-gradient(to right, ${start}, ${end})`
}

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
    // Id-taking so the bar can forward its own stable setters straight through; per-chip closures
    // would change identity every render and drag each chip's Tooltip/Button subtree with them.
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onRename: (id: string, title: string) => void
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
    onSelect,
    onClose,
    onRename,
}: SessionTagProps) {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const label = session.title || text || `Chat ${index + 1}`
    const tabRef = useRef<HTMLDivElement>(null)
    const labelRef = useRef<SessionTabLabelHandle>(null)
    // Hide the hover actions while the inline rename input owns the row.
    const [renaming, setRenaming] = useState(false)
    // Mount the hover actions on hover/focus rather than rendering them behind `opacity-0` — see
    // the matching note in SessionRail: each button carries a Tooltip + Trigger + icon subtree.
    const [hot, setHot] = useState(false)
    const onEnter = useCallback(() => setHot(true), [])
    const onLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        // Don't unmount the cluster out from under keyboard focus (symmetric with onBlurChip).
        if (!e.currentTarget.contains(document.activeElement)) setHot(false)
    }, [])
    const onBlurChip = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false)
    }, [])
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
    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                handleSelect()
            }
        },
        [handleSelect],
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
        // Wrapper collapses its width + gap margin on enter/exit so neighbours close up with no snap.
        <motion.div
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
            className="shrink-0 overflow-hidden"
        >
            <div
                role="tab"
                aria-selected={active}
                tabIndex={0}
                onClick={handleSelect}
                onKeyDown={onKeyDown}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                onFocus={onEnter}
                onBlur={onBlurChip}
                className={clsx(
                    // Floor the width so short labels ("hi") still leave a clickable label zone to the
                    // left of the hover actions (rename/close overlay the right ~58px) — otherwise a
                    // tiny chip is fully covered on hover and the click lands on a button, not select.
                    "group relative flex h-7 min-w-[112px] max-w-[180px] cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 text-xs transition-colors",
                    // White pill on the recessed chat canvas (raised); the active tab keeps the
                    // primary text + a 2px accent underline so it's unmistakable against neighbours.
                    active
                        ? "border-colorBorder border-b-2 border-b-[var(--ag-surface-accent)] bg-colorBgContainer text-colorText"
                        : "border-colorBorderSecondary bg-colorBgContainer text-colorTextSecondary hover:border-colorBorder",
                )}
            >
                <SessionStatusDot sessionId={session.id} active={active} />
                <SessionTabLabel
                    ref={labelRef}
                    label={label}
                    onRename={handleRename}
                    onEditingChange={setRenaming}
                    className="block min-w-0 flex-1 truncate"
                />
                {/* Hover actions overlay the label's tail — absolutely positioned so no width is
                    reserved at rest (no pixel shift). The gradient fades the covered text out under
                    the buttons instead of hard-clipping it. */}
                {hot && !renaming && (
                    <div className="absolute inset-y-0 right-0 flex items-center">
                        <span
                            aria-hidden
                            className="h-full w-3 bg-gradient-to-l from-colorBgContainer to-transparent"
                        />
                        <span className="flex h-full items-center gap-0.5 rounded-r-md bg-colorBgContainer pr-1">
                            <Tooltip title="Rename session" mouseEnterDelay={0.5}>
                                <Button
                                    type="text"
                                    aria-label="Rename session"
                                    icon={PENCIL_ICON}
                                    onClick={startRename}
                                    className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                                />
                            </Tooltip>
                            {closable && (
                                <Button
                                    type="text"
                                    aria-label="Close session"
                                    icon={X_ICON}
                                    onClick={handleClose}
                                    className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                                />
                            )}
                        </span>
                    </div>
                )}
            </div>
        </motion.div>
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
    onRename: (id: string, title: string) => void
    /** Right-aligned extras (e.g. the session-history menu). */
    extra?: React.ReactNode
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
    onRename,
    extra,
    showSessions = true,
}: SessionTagBarProps) => {
    const closable = sessions.length > 1
    // Session ids present when the bar first mounted. Seeded once; NOT topped up, so an id that
    // appears later reads as "added after mount" and scrolls smoothly (see SessionTag).
    const presentAtMountRef = useRef<Set<string>>(new Set())
    const seededRef = useRef(false)
    if (!seededRef.current) {
        seededRef.current = true
        sessions.forEach((s) => presentAtMountRef.current.add(s.id))
    }
    // Edge fade is applied per side only where the strip is actually scrolled past its content, so
    // a strip that fits (single tab, no scroll) shows no fade on either edge.
    const [fade, setFade] = useState({left: false, right: false})
    const stripElRef = useRef<HTMLDivElement | null>(null)
    const measureFade = useCallback(() => {
        const el = stripElRef.current
        if (!el) return
        const overflow = el.scrollWidth - el.clientWidth > 1
        setFade({
            left: overflow && el.scrollLeft > 1,
            right: overflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
        })
    }, [])
    // React 19 registers onWheel as passive, so preventDefault would be a no-op. Attach a native
    // non-passive listener that maps vertical wheel delta to horizontal scroll; also track scroll +
    // resize to recompute the edge fade.
    const stripCleanupRef = useRef<(() => void) | null>(null)
    const scrollStripRef = useCallback(
        (el: HTMLDivElement | null) => {
            stripCleanupRef.current?.()
            stripCleanupRef.current = null
            stripElRef.current = el
            if (!el) return
            const onWheel = (e: WheelEvent) => {
                if (el.scrollWidth <= el.clientWidth) return
                const axis = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
                if (axis === 0) return
                // Wheels report deltaMode=LINE (tiny integers) and the strip has scroll-smooth —
                // together they crawl. Normalize to px, scroll instantly.
                const delta =
                    e.deltaMode === 1 ? axis * 16 : e.deltaMode === 2 ? axis * el.clientWidth : axis
                e.preventDefault()
                const prev = el.style.scrollBehavior
                el.style.scrollBehavior = "auto"
                el.scrollLeft += delta
                el.style.scrollBehavior = prev
            }
            el.addEventListener("wheel", onWheel, {passive: false})
            el.addEventListener("scroll", measureFade, {passive: true})
            const ro = new ResizeObserver(() => measureFade())
            ro.observe(el)
            measureFade()
            stripCleanupRef.current = () => {
                el.removeEventListener("wheel", onWheel)
                el.removeEventListener("scroll", measureFade)
                ro.disconnect()
            }
        },
        [measureFade],
    )
    // A ResizeObserver watches the element box, not its content — remeasure when the tab set changes.
    useEffect(() => {
        measureFade()
    }, [sessions, measureFade])
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-[48px] min-w-0 w-full shrink-0 items-center gap-2 overflow-hidden border-0 border-b border-solid border-[var(--ag-surface-card-border)] bg-[var(--ag-surface-canvas)] px-3">
                {showSessions ? (
                    <div
                        ref={scrollStripRef}
                        className="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        style={{
                            maskImage: fadeMask(fade.left, fade.right),
                            WebkitMaskImage: fadeMask(fade.left, fade.right),
                        }}
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
                                    onSelect={onSelect}
                                    onClose={onClose}
                                    onRename={onRename}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                ) : (
                    <div className="min-w-0 flex-1" />
                )}
                {/* Fixed session-actions cluster — pinned outside the scroll area so New session (+) sits
                at the end of the tab strip without scrolling away, grouped with the inspect/history
                controls. */}
                {(showSessions || extra) && (
                    <div className="flex shrink-0 items-center gap-1">
                        {showSessions && (
                            <Tooltip
                                title={
                                    addDisabled
                                        ? "Available after your agent's first response"
                                        : "New session"
                                }
                            >
                                {/* Non-disabled span trigger: antd v6 Tooltips don't fire on a disabled Button. */}
                                <span className="inline-flex">
                                    <Button
                                        type="text"
                                        aria-label="New session"
                                        icon={<Plus size={14} />}
                                        onClick={onAdd}
                                        disabled={addDisabled}
                                        className="!h-7 !w-7 !min-w-0 shrink-0 !p-0"
                                    />
                                </span>
                            </Tooltip>
                        )}
                        {extra}
                    </div>
                )}
            </div>
        </MotionConfig>
    )
}

export default SessionTagBar
