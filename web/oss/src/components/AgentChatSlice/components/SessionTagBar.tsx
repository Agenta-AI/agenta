import {useEffect, useRef, useState} from "react"

import {PencilSimple, Plus, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    type AgentChatSession,
    type SessionRunStatus,
    sessionFirstUserTextAtomFamily,
    sessionStatusAtomFamily,
} from "../state/sessions"

import SessionTabLabel, {type SessionTabLabelHandle} from "./SessionTabLabel"

/** `attention` states need the user (approval / input) or flag a failure — their semantic colour
 * outranks the active tab's clean white dot, so it's never masked on the session you're viewing. */
const STATUS_META: Record<
    SessionRunStatus,
    {dot: string; pulse: boolean; attention: boolean; title: string}
> = {
    running: {dot: "bg-colorInfo", pulse: true, attention: false, title: "Responding…"},
    awaiting: {dot: "bg-colorWarning", pulse: true, attention: true, title: "Needs your input"},
    error: {dot: "bg-colorError", pulse: false, attention: true, title: "Last run failed"},
    idle: {dot: "bg-colorTextQuaternary", pulse: false, attention: false, title: "Idle"},
}

/** A session's run-state dot. Subscribes to just that session's status atom so a streaming
 * conversation repaints only its own dot, never the whole bar. */
export const SessionStatusDot = ({
    sessionId,
    active = false,
}: {
    sessionId: string
    active?: boolean
}) => {
    const status = useAtomValue(sessionStatusAtomFamily(sessionId))
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

interface SessionTagProps {
    session: AgentChatSession
    index: number
    active: boolean
    closable: boolean
    /** True when this session already existed at the bar's first mount (reload restore) — an
     * activation here jumps instantly; a session added afterwards keeps the smooth scroll. */
    presentAtMount: boolean
    onSelect: () => void
    onClose: () => void
    onRename: (title: string) => void
}

/** One session chip: status dot + truncated label (double-click or pencil to rename) + hover
 * actions. The rename/close buttons float OVER the label's tail (Chrome-tab style) instead of
 * reserving in-flow width, so revealing them on hover never reflows the label or shifts pixels. */
const SessionTag = ({
    session,
    index,
    active,
    closable,
    presentAtMount,
    onSelect,
    onClose,
    onRename,
}: SessionTagProps) => {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const label = session.title || text || `Chat ${index + 1}`
    const tabRef = useRef<HTMLDivElement>(null)
    const labelRef = useRef<SessionTabLabelHandle>(null)
    // Hide the hover actions while the inline rename input owns the row.
    const [renaming, setRenaming] = useState(false)
    // Keep the active tab visible. Jump INSTANTLY only on the bar's initial reveal of a session that
    // was already present at mount (reload restoring a far-away active tab) — the strip's scroll-smooth
    // would otherwise play a long scroll across the whole strip. A session added later, or any user
    // switch, keeps the CSS smooth nudge (so a freshly-created tab still glides into view).
    const mountedRef = useRef(false)
    useEffect(() => {
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
        <div
            ref={tabRef}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={onSelect}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onSelect()
                }
            }}
            className={clsx(
                "group relative flex h-7 max-w-[180px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 text-xs transition-colors",
                // White pill on the recessed chat canvas (raised); the active tab keeps the primary
                // text + a 2px accent underline so it's unmistakable against its neighbours.
                active
                    ? "border-colorBorder border-b-2 border-b-[var(--ag-surface-accent)] bg-colorBgContainer text-colorText"
                    : "border-colorBorderSecondary bg-colorBgContainer text-colorTextSecondary hover:border-colorBorder",
            )}
        >
            <SessionStatusDot sessionId={session.id} active={active} />
            <SessionTabLabel
                ref={labelRef}
                label={label}
                onRename={onRename}
                onEditingChange={setRenaming}
                className="block min-w-0 flex-1 truncate"
            />
            {/* Hover actions overlay the label's tail — absolutely positioned so no width is
                reserved at rest (no pixel shift). The gradient fades the covered text out under
                the buttons instead of hard-clipping it. */}
            {!renaming && (
                <div
                    className={clsx(
                        "pointer-events-none absolute inset-y-0 right-0 flex items-center opacity-0 transition-opacity",
                        "group-hover:pointer-events-auto group-hover:opacity-100",
                        "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
                    )}
                >
                    <span
                        aria-hidden
                        className="h-full w-3 bg-gradient-to-l from-colorBgContainer to-transparent"
                    />
                    <span className="flex h-full items-center gap-0.5 rounded-r-md bg-colorBgContainer pr-1">
                        <Tooltip title="Rename session" mouseEnterDelay={0.5}>
                            <Button
                                type="text"
                                aria-label="Rename session"
                                icon={<PencilSimple size={12} />}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    labelRef.current?.startEditing()
                                }}
                                className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                            />
                        </Tooltip>
                        {closable && (
                            <Button
                                type="text"
                                aria-label="Close session"
                                icon={<X size={12} />}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onClose()
                                }}
                                className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                            />
                        )}
                    </span>
                </div>
            )}
        </div>
    )
}

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
    return (
        <div className="flex h-[48px] min-w-0 w-full shrink-0 items-center gap-2 overflow-hidden border-0 border-b border-solid border-[var(--ag-surface-card-border)] px-3">
            {showSessions ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {sessions.map((session, index) => (
                        <SessionTag
                            key={session.id}
                            session={session}
                            index={index}
                            active={session.id === activeId}
                            closable={closable}
                            presentAtMount={presentAtMountRef.current.has(session.id)}
                            onSelect={() => onSelect(session.id)}
                            onClose={() => onClose(session.id)}
                            onRename={(title) => onRename(session.id, title)}
                        />
                    ))}
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
    )
}

export default SessionTagBar
