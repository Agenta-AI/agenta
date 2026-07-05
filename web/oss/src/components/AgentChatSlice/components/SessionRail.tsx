import {useCallback, useEffect, useRef, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {MagnifyingGlass, Plus, Trash} from "@phosphor-icons/react"
import {Empty, Input, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {SessionInspectorButton} from "@/oss/components/SessionInspector"

import {useChatScopeKey} from "../state/scope"
import {
    type AgentChatSession,
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    deleteSessionAtomFamily,
    firstUserText,
    openSessionAtomFamily,
    openSessionIdsAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
    timeAgo,
} from "../state/sessions"

import SessionTabLabel from "./SessionTabLabel"
import {SessionStatusDot} from "./SessionTagBar"

interface SessionRailRowProps {
    session: AgentChatSession
    label: string
    active: boolean
    open: boolean
    /** True when this row is newly added since the rail mounted (animate its entrance). */
    enter: boolean
    /** True while this row is being removed (collapse + fade before it unmounts). */
    leaving: boolean
    onSelect: () => void
    onDelete: () => void
    onRename: (title: string) => void
}

/** One history row: status dot + label (double-click to rename) + created-at stamp, with an
 * inspect action on the active row and a hover-revealed delete. Wrapped in a grid-rows collapse so
 * it eases in on add and out on remove (siblings reflow smoothly). */
const SessionRailRow = ({
    session,
    label,
    active,
    open,
    enter,
    leaving,
    onSelect,
    onDelete,
    onRename,
}: SessionRailRowProps) => {
    // Start collapsed only for genuinely-new rows; reveal a frame later so the transition plays.
    const [shown, setShown] = useState(!enter)
    useEffect(() => {
        const raf = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(raf)
    }, [])
    useEffect(() => {
        if (leaving) setShown(false)
    }, [leaving])

    const expanded = shown && !leaving
    return (
        <div
            className="grid motion-safe:transition-[grid-template-rows,opacity] motion-safe:duration-200 motion-safe:ease-out"
            style={{gridTemplateRows: expanded ? "1fr" : "0fr", opacity: expanded ? 1 : 0}}
            aria-hidden={leaving}
        >
            <div className="min-h-0 overflow-hidden">
                <div
                    role="tab"
                    aria-selected={active}
                    tabIndex={leaving ? -1 : 0}
                    onClick={onSelect}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            onSelect()
                        }
                    }}
                    className={clsx(
                        "group flex cursor-pointer items-center gap-2 rounded-md border border-solid px-2 py-1.5 transition-colors",
                        active ? "ag-surface-selected" : "ag-row-hover border-transparent",
                    )}
                >
                    <SessionStatusDot sessionId={session.id} />
                    <div className="flex min-w-0 flex-1 flex-col">
                        <SessionTabLabel
                            label={label}
                            onRename={onRename}
                            className={clsx(
                                "block min-w-0 truncate text-xs",
                                active ? "text-colorText" : "text-colorTextSecondary",
                            )}
                        />
                        {timeAgo(session.createdAt) && (
                            <span className="text-[11px] text-colorTextTertiary">
                                {timeAgo(session.createdAt)}
                            </span>
                        )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                        {open && !active && (
                            <span className="ag-surface-chip rounded px-1.5 py-px text-[11px] text-colorTextSecondary">
                                open
                            </span>
                        )}
                        {active && <SessionInspectorButton sessionId={session.id} />}
                        <Tooltip title="Delete session">
                            <Button
                                aria-label="Delete session"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    onDelete()
                                }}
                                className="!h-5 !w-5 !min-w-0 shrink-0 !p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                variant="ghost"
                                size="icon"
                            >
                                {<Trash size={12} />}
                            </Button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    )
}

export interface SessionRailProps {
    /** The resolved active session id (source of truth for the chat), used for row highlight. */
    activeId?: string
    className?: string
}

/**
 * Vertical session navigator for the full-screen agent chat. Lists the full session HISTORY
 * (`sessionHistoryAtomFamily`, newest first) — the same data as the session-history popover — so
 * the two stay consistent, and uses the space freed by maximizing to make every past session
 * directly reachable. Clicking a row reopens it as the active tab; rename inline, delete permanently.
 */
const SessionRail = ({activeId, className}: SessionRailProps) => {
    const scope = useChatScopeKey()
    const history = useAtomValue(sessionHistoryAtomFamily(scope))
    const openIds = useAtomValue(openSessionIdsAtomFamily(scope))
    const allMessages = useAtomValue(sessionMessagesAtom)
    const resolvedActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const openSession = useSetAtom(openSessionAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const deleteSession = useSetAtom(deleteSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))

    const [query, setQuery] = useState("")
    const q = query.trim().toLowerCase()
    const currentActiveId = activeId ?? resolvedActiveId

    // Ids present at mount aren't "new" (don't animate the initial list in); ids that appear later
    // are. `seenRef` is seeded on first render and topped up after each render.
    const seenRef = useRef<Set<string>>(new Set())
    const initedRef = useRef(false)
    if (!initedRef.current) {
        initedRef.current = true
        history.forEach((s) => seenRef.current.add(s.id))
    }
    useEffect(() => {
        history.forEach((s) => seenRef.current.add(s.id))
    }, [history])

    // Deleting keeps the row mounted for the exit animation, THEN removes it from history. The
    // pending timers are tracked so an unmount mid-animation (e.g. revision switch) clears them
    // instead of firing `deleteSession` against a stale scope afterwards.
    const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(() => new Set())
    const deleteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
    useEffect(
        () => () => {
            deleteTimersRef.current.forEach((t) => clearTimeout(t))
            deleteTimersRef.current.clear()
        },
        [],
    )
    const handleDelete = useCallback(
        (id: string) => {
            setLeavingIds((prev) => new Set(prev).add(id))
            const timer = setTimeout(() => {
                deleteTimersRef.current.delete(id)
                deleteSession(id)
                setLeavingIds((prev) => {
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                })
            }, 220)
            deleteTimersRef.current.set(id, timer)
        },
        [deleteSession],
    )

    const rows = history.map((session) => ({
        session,
        label: session.title || firstUserText(allMessages[session.id]) || "Untitled chat",
    }))
    const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows

    return (
        <div
            className={clsx(
                "ag-panel-raised flex h-full min-h-0 flex-col border-0 border-r border-solid border-[var(--ag-surface-divider)]",
                className,
            )}
        >
            <div className="flex h-[48px] shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-[var(--ag-surface-divider)] px-3">
                <span className="text-xs font-medium text-colorTextSecondary">Sessions</span>
                <Tooltip title="New session">
                    <Button
                        aria-label="New session"
                        onClick={() => addSession()}
                        className="!h-7 !w-7 !min-w-0 shrink-0 !p-0"
                        variant="ghost"
                        size="icon"
                    >
                        {<Plus size={14} />}
                    </Button>
                </Tooltip>
            </div>

            <div className="shrink-0 px-2 pt-2">
                <Input
                    allowClear
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sessions"
                    prefix={<MagnifyingGlass size={14} className="text-colorTextTertiary" />}
                    className="!text-xs !border-[var(--ag-surface-inset-border)] !bg-[var(--ag-surface-inset)]"
                />
            </div>

            <div
                role="tablist"
                aria-label="Sessions"
                className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
            >
                {history.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span className="text-xs">No sessions yet</span>}
                        className="!my-6"
                    />
                ) : filtered.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs text-colorTextTertiary">
                        No matching sessions
                    </div>
                ) : (
                    filtered.map(({session, label}) => (
                        <SessionRailRow
                            key={session.id}
                            session={session}
                            label={label}
                            active={session.id === currentActiveId}
                            open={openIds.has(session.id)}
                            enter={!seenRef.current.has(session.id)}
                            leaving={leavingIds.has(session.id)}
                            onSelect={() => openSession(session.id)}
                            onDelete={() => handleDelete(session.id)}
                            onRename={(title) => renameSession({id: session.id, title})}
                        />
                    ))
                )}
            </div>
        </div>
    )
}

export default SessionRail
