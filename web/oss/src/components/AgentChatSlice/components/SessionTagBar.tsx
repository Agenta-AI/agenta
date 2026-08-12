import {memo, useCallback, useEffect, useRef, useState} from "react"

import {PencilSimple, Plus, X} from "@phosphor-icons/react"
import {Button, Dropdown, Tooltip} from "antd"
import type {MenuProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {SESSION_SPRING, TAG_VARIANTS} from "../assets/sessionMotion"
import {useSessionActions} from "../hooks/useSessionActions"
import {type SessionDotStatus, sessionDotStatusAtomFamily} from "../state/liveness"
import {useChatScopeKey} from "../state/scope"
import {type AgentChatSession, sessionFirstUserTextAtomFamily} from "../state/sessions"

import {SESSION_RUN_GLYPH_PX, SessionRunSpinner} from "./SessionRunSpinner"
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

/** A session's run-state indicator: the shared spinner while a turn is in flight (the same glyph
 * the sidebar's session rows use), a semantic dot for every other state. Subscribes to just that
 * session's effective-status atom (local run state, or backend liveness when idle here) so a
 * streaming conversation repaints only its own indicator, never the whole bar. */
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
        // The box is the spinner's size in EVERY state, so a run starting or ending swaps the glyph
        // without shifting the label beside it.
        <span
            className="relative flex shrink-0 items-center justify-center"
            style={{width: SESSION_RUN_GLYPH_PX, height: SESSION_RUN_GLYPH_PX}}
            title={meta.title}
        >
            {status === "running" ? (
                <SessionRunSpinner />
            ) : (
                <span
                    className={clsx(
                        "relative flex h-1.5 w-1.5",
                        // A halo ring makes an attention dot read as a badge even at 6px, so it
                        // stands out across a row of tabs without enlarging the dot itself.
                        meta.attention && "rounded-full ring-2 ring-offset-0",
                        status === "awaiting" && "ring-colorWarningBorder",
                        status === "error" && "ring-colorErrorBorder",
                    )}
                >
                    {meta.pulse && (
                        <span
                            className={clsx(
                                "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
                                dotClassName,
                            )}
                        />
                    )}
                    <span
                        className={clsx(
                            "relative inline-flex h-1.5 w-1.5 rounded-full",
                            dotClassName,
                        )}
                    />
                </span>
            )}
        </span>
    )
}

// Static icon elements — see the note in SessionRail: an inline `<Icon />` is a new prop each render.
const PENCIL_ICON = <PencilSimple size={12} />
const X_ICON = <X size={12} />

/** Right-edge fade masks for the tab label: overflow dissolves into the tag's own fill (never an
 * ellipsis, never a painted patch). Hover widens the fade to clear the action icons; the label
 * element's width never changes, so nothing reflows. */
const maskStyle = (img: string): React.CSSProperties => ({
    WebkitMaskImage: img,
    maskImage: img,
})
const LABEL_MASK_REST = maskStyle("linear-gradient(to right, #000 calc(100% - 14px), transparent)")
const LABEL_MASK_HOVER = maskStyle(
    "linear-gradient(to right, #000 calc(100% - 60px), transparent calc(100% - 38px))",
)

interface SessionTagProps {
    session: AgentChatSession
    index: number
    active: boolean
    closable: boolean
    /** True when this session already existed at the bar's first mount (reload restore) — an
     * activation here jumps instantly; a session added afterwards keeps the smooth scroll. */
    presentAtMount: boolean
    /** Renders a hairline divider after this tag — every session but the last (plain labels are
     * separated by the divider now, not by a bordered card). */
    showDivider: boolean
    // Id-taking so the bar can forward its own stable setters straight through; per-chip closures
    // would change identity every render and drag each chip's Tooltip/Button subtree with them.
    onSelect: (id: string) => void
    onClose: (id: string) => void
    onRename: (id: string, title: string) => void
    /** Right-click actions, from the shared `useSessionActions` set. */
    menu: MenuProps
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
    onSelect,
    onClose,
    onRename,
    menu,
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
        const wasMounted = mountedRef.current
        mountedRef.current = true
        // Belt-and-suspenders for a freshly-added active tab: onUpdate re-nudges it on every
        // animation frame while its width is growing, but if a frame gets skipped (throttled tab,
        // slow paint) the last correction could still land short. One more check once the ~280ms
        // session spring has settled catches that case for good.
        if (active && !presentAtMount && !wasMounted) {
            const t = setTimeout(() => {
                tabRef.current?.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                    behavior: "instant",
                })
            }, 320)
            return () => clearTimeout(t)
        }
    }, [active, presentAtMount])
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
                // Native scrollIntoView finds the real scrollable ancestor on its own — it doesn't
                // need (and shouldn't assume) any particular DOM nesting between the tag and the
                // strip, which an intermediate wrapper (e.g. the tags-only measurement div in
                // SessionTagBar) would otherwise silently break.
                if (!(active && !presentAtMount)) return
                tabRef.current?.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                    behavior: "instant",
                })
            }}
            className="flex shrink-0 items-center overflow-hidden"
        >
            <Dropdown menu={menu} trigger={["contextMenu"]}>
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
                        // Floor the width so short labels keep a clickable select zone even when the
                        // inline hover actions appear and the label truncates.
                        "group relative flex h-7 min-w-[112px] max-w-[180px] cursor-pointer items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
                        // No card, no border — plain labels on the canvas, separated by the hairline
                        // divider below. Selected reads by fill alone: `colorFill` is the antd
                        // "pressed/active" step (one notch past the Secondary/Tertiary/Quaternary
                        // hover washes), ink-tinted in light, translucent white in dark — clearly
                        // stronger than the whisper-of-fill hover state unselected tags get.
                        active
                            ? "bg-colorFill text-colorText"
                            : "text-colorTextSecondary hover:bg-colorFillTertiary",
                    )}
                >
                    <SessionStatusDot sessionId={session.id} active={active} />
                    <SessionTabLabel
                        ref={labelRef}
                        label={label}
                        onRename={handleRename}
                        onEditingChange={setRenaming}
                        className="block min-w-0 flex-1 overflow-hidden whitespace-nowrap"
                        // A mask fades the text into the tag's OWN fill (no ellipsis, no painted
                        // patch, theme-proof). Hover widens the fade to end before the icons, so
                        // the label never reflows and nothing shifts.
                        style={hot && !renaming ? LABEL_MASK_HOVER : LABEL_MASK_REST}
                    />
                    {/* Hover actions float over the masked tail — transparent buttons directly on
                    the tag fill, no backing (any painted patch reads as a mismatched box). */}
                    {hot && !renaming && (
                        <div
                            className="absolute inset-y-0 right-1 flex items-center gap-0.5"
                            // Focusing the tag reveals these, so they are keyboard-reachable — and
                            // Enter/Space on one would otherwise also bubble to the tab's own
                            // handler and select the session alongside renaming or closing it.
                            onKeyDown={(e) => e.stopPropagation()}
                        >
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
                        </div>
                    )}
                </div>
            </Dropdown>
            {/* Hairline divider, not a card border — travels with the tag (inside its collapsing
            motion.div) so it disappears smoothly along with a removed session instead of leaving
            an orphaned line. `colorBorderSecondary`: the same soft hairline already used for this
            bar's own bottom border, one step lighter than a visible UI border. */}
            {showDivider && (
                <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 bg-colorBorderSecondary" />
            )}
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
    onRename,
    extra,
    leftExtra,
    showSessions = true,
}: SessionTagBarProps) => {
    const closable = sessions.length > 1
    // Right-click a chip for the same verbs the sessions list offers. Scope IS the owning agent,
    // so the local tab cache and the server stay in step.
    const scope = useChatScopeKey()
    const {menuItems, onMenuClick} = useSessionActions()
    const menuFor = useCallback(
        (session: AgentChatSession): MenuProps => {
            const target = {
                sessionId: session.id,
                appId: scope,
                name: session.title,
                archived: Boolean(session.archived),
            }
            return {items: menuItems(target), onClick: onMenuClick(target)}
        },
        [menuItems, onMenuClick, scope],
    )
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
    // The New-session (+) button lives inline right after the last tag by default, and only docks
    // to the fixed right-side cluster when the tags alone (not counting +) would overflow the
    // strip — so it's always reachable without scrolling. Measured against a reserved slot rather
    // than the button's actual (inline-or-docked) width, so the decision never depends on where
    // the button currently renders — that would oscillate right at the boundary (dock it → strip
    // has room again → undock it → overflows again → ...).
    const PLUS_SLOT_PX = 40
    const [overflowing, setOverflowing] = useState(false)
    const tagsWrapElRef = useRef<HTMLDivElement | null>(null)
    const measureLayout = useCallback(() => {
        const el = stripElRef.current
        if (!el) return
        const overflow = el.scrollWidth - el.clientWidth > 1
        setFade({
            left: overflow && el.scrollLeft > 1,
            right: overflow && el.scrollLeft < el.scrollWidth - el.clientWidth - 1,
        })
        const tagsWrap = tagsWrapElRef.current
        if (tagsWrap) {
            setOverflowing(tagsWrap.scrollWidth > el.clientWidth - PLUS_SLOT_PX)
        }
    }, [])
    // React 19 registers onWheel as passive, so preventDefault would be a no-op. Attach a native
    // non-passive listener that maps vertical wheel delta to horizontal scroll; also track scroll +
    // resize to recompute the edge fade and the inline/docked + decision.
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
            el.addEventListener("scroll", measureLayout, {passive: true})
            const ro = new ResizeObserver(() => measureLayout())
            ro.observe(el)
            measureLayout()
            stripCleanupRef.current = () => {
                el.removeEventListener("wheel", onWheel)
                el.removeEventListener("scroll", measureLayout)
                ro.disconnect()
            }
        },
        [measureLayout],
    )
    // A ResizeObserver watches the element box, not its content — remeasure when the tab set
    // changes. A tag's width animates in over the session spring (~280ms), so also re-check once
    // it's settled — otherwise a session added right at the boundary can measure against its
    // still-growing width and land on the wrong side of the inline/docked decision.
    useEffect(() => {
        measureLayout()
        const t = setTimeout(measureLayout, 300)
        return () => clearTimeout(t)
    }, [sessions, measureLayout])
    // A freshly-created session is always appended last and always becomes the active one.
    // SessionTag's own scrollIntoView keeps that TAG in view, but the inline + sits right after
    // it in the strip's scroll content — "nearest" only guarantees the tag itself is visible, so
    // the + immediately past it could still clip at the edge. Scrolling the strip to its actual
    // end (not just "the active tag") reveals both together — and is equally correct when the +
    // is docked instead, since then the tags are the only thing in the scrollable content anyway.
    // `null` until the first populated render. Sessions arrive async, so everything present then is
    // RESTORED, not newly created — seeding on it stops a reload from yanking the strip to its end
    // over whatever tab was actually restored.
    const prevSessionIdsRef = useRef<Set<string> | null>(null)
    useEffect(() => {
        const ids = new Set(sessions.map((s) => s.id))
        const seen = prevSessionIdsRef.current
        if (seen === null && ids.size === 0) return
        prevSessionIdsRef.current = ids
        const isNewActiveSession =
            seen !== null && !!activeId && ids.has(activeId) && !seen.has(activeId)
        if (!isNewActiveSession) return
        const strip = stripElRef.current
        const tagsWrap = tagsWrapElRef.current
        if (!strip) return
        const scrollToEnd = () => strip.scrollTo({left: strip.scrollWidth, behavior: "instant"})
        scrollToEnd()
        // The new tag's width animates in over the session spring, growing scrollWidth as it goes
        // — a single fixed-delay re-scroll can land short if the spring settles later than its
        // ~280ms nominal duration (e.g. under load). Re-scroll on every actual layout change of
        // the tags content instead of guessing a delay, so the correction tracks the real
        // animation regardless of how long it takes.
        let ro: ResizeObserver | undefined
        if (tagsWrap) {
            ro = new ResizeObserver(scrollToEnd)
            ro.observe(tagsWrap)
        }
        // Hard stop so the observer doesn't outlive the animation — otherwise a legitimate later
        // window resize (or the user manually scrolling away) would keep getting yanked back.
        const t = setTimeout(() => ro?.disconnect(), 600)
        return () => {
            clearTimeout(t)
            ro?.disconnect()
        }
    }, [sessions, activeId])
    const newSessionButton = showSessions ? (
        <Tooltip
            title={addDisabled ? "Available after your agent's first response" : "New session"}
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
    ) : null
    return (
        <MotionConfig reducedMotion="user">
            <div className="flex h-[48px] min-w-0 w-full shrink-0 items-center gap-2 overflow-hidden border-0 border-b border-solid border-[var(--ag-surface-card-border)] bg-[var(--ag-surface-canvas)] px-3">
                {/* Leading edge — the config-panel reveal control lands here (the spot the panel
                collapsed from). Its own fade+slide-in uses the same easing as the panel's CSS
                slide (`playground-splitter-animated`) so the two reads as one motion. */}
                <AnimatePresence initial={false}>
                    {leftExtra && (
                        <motion.div
                            key="left-extra"
                            initial={{opacity: 0, x: -4}}
                            animate={{opacity: 1, x: 0}}
                            exit={{opacity: 0, x: -4}}
                            transition={{duration: 0.24, ease: [0.4, 0, 0.2, 1]}}
                            className="flex shrink-0 items-center"
                        >
                            {leftExtra}
                        </motion.div>
                    )}
                </AnimatePresence>
                {showSessions ? (
                    <div
                        ref={scrollStripRef}
                        className="flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                        style={{
                            maskImage: fadeMask(fade.left, fade.right),
                            WebkitMaskImage: fadeMask(fade.left, fade.right),
                        }}
                    >
                        <div ref={tagsWrapElRef} className="flex items-center">
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
                                        onSelect={onSelect}
                                        onClose={onClose}
                                        onRename={onRename}
                                        menu={menuFor(session)}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                        {/* Inline home for + — immediately after the last tag, not pinned at the
                        bar's far right. Swaps to the docked copy below once the tags alone would
                        overflow, so + is always reachable without scrolling. */}
                        {!overflowing && (
                            <span className="ml-1.5 flex shrink-0 items-center">
                                {newSessionButton}
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="min-w-0 flex-1" />
                )}
                {/* Fixed session-actions cluster — pinned outside the scroll area, grouped with the
                inspect/history controls. New session (+) only lives here once the strip overflows
                (see `overflowing` above); otherwise it's inline in the strip. */}
                {(showSessions || extra) && (
                    <div className="flex shrink-0 items-center gap-1">
                        {showSessions && overflowing && newSessionButton}
                        {extra}
                    </div>
                )}
            </div>
        </MotionConfig>
    )
}

export default SessionTagBar
