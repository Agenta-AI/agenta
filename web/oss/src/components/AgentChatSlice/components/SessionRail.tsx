import {useRef, useState} from "react"

import {MagnifyingGlass, PencilSimple, Plus, Trash} from "@phosphor-icons/react"
import {Button, Empty, Input, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import {AnimatePresence, MotionConfig, motion} from "motion/react"

import {ROW_VARIANTS, SESSION_SPRING} from "../assets/sessionMotion"
import {useChatScopeKey} from "../state/scope"
import {
    type AgentChatSession,
    activeSessionIdAtomFamily,
    addSessionAtomFamily,
    deleteSessionAtomFamily,
    firstUserText,
    isSessionHusk,
    openSessionAtomFamily,
    openSessionIdsAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
    timeAgo,
} from "../state/sessions"

import SessionTabLabel, {type SessionTabLabelHandle} from "./SessionTabLabel"
import {SessionStatusDot} from "./SessionTagBar"

interface SessionRailRowProps {
    session: AgentChatSession
    label: string
    active: boolean
    onSelect: () => void
    onDelete: () => void
    onRename: (title: string) => void
}

/** History row: status dot, label (double-click or pencil to rename), timestamp, with an inspect
 * action on the active row and hover-revealed rename/delete; collapses its height + gap margin on
 * enter/exit so nothing snaps. */
const SessionRailRow = ({
    session,
    label,
    active,
    onSelect,
    onDelete,
    onRename,
}: SessionRailRowProps) => {
    const labelRef = useRef<SessionTabLabelHandle>(null)
    // Hide the action cluster while the inline rename input owns the row, so it gets full width.
    const [renaming, setRenaming] = useState(false)
    return (
        <motion.div
            variants={ROW_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={SESSION_SPRING}
            // shrink-0 so a long history overflows into a scroll instead of the flex column
            // squashing every row to fit (which clips the timestamp line).
            className="shrink-0 overflow-hidden"
        >
            <div
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
                    "group flex cursor-pointer items-center gap-2 rounded-md border border-solid px-2 py-1.5 transition-colors",
                    active ? "ag-surface-selected" : "ag-row-hover border-transparent",
                )}
            >
                <SessionStatusDot sessionId={session.id} />
                <div className="flex min-w-0 flex-1 flex-col">
                    <SessionTabLabel
                        ref={labelRef}
                        label={label}
                        onRename={onRename}
                        onEditingChange={setRenaming}
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
                <div className={clsx("flex shrink-0 items-center gap-0.5", renaming && "hidden")}>
                    {/* Inspection is build-mode only, so the chat-mode rail has no inspect entry. */}
                    <Tooltip title="Rename session">
                        <Button
                            type="text"
                            aria-label="Rename session"
                            icon={<PencilSimple size={12} />}
                            onClick={(e) => {
                                e.stopPropagation()
                                labelRef.current?.startEditing()
                            }}
                            className="!h-5 !w-5 !min-w-0 shrink-0 !p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        />
                    </Tooltip>
                    <Tooltip title="Delete session">
                        <Button
                            type="text"
                            aria-label="Delete session"
                            icon={<Trash size={12} />}
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete()
                            }}
                            className="!h-5 !w-5 !min-w-0 shrink-0 !p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                        />
                    </Tooltip>
                </div>
            </div>
        </motion.div>
    )
}

export interface SessionRailProps {
    /** The resolved active session id (source of truth for the chat), used for row highlight. */
    activeId?: string
    /** Disable the New session (+) button (e.g. onboarding, until the founding run settles). */
    addDisabled?: boolean
    className?: string
}

/**
 * Vertical session navigator for the full-screen agent chat. Lists the full session HISTORY
 * (`sessionHistoryAtomFamily`, newest first) — the same data as the session-history popover — so
 * the two stay consistent, and uses the space freed by maximizing to make every past session
 * directly reachable. Clicking a row reopens it as the active tab; rename inline, delete permanently.
 */
const SessionRail = ({activeId, addDisabled = false, className}: SessionRailProps) => {
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

    // Hide never-initiated husks (untitled, no messages) unless they're an open tab — so a blank
    // in-progress session still shows, but abandoned empties don't clutter the list (the mount-time
    // prune then drops them from storage). Matches the discard-on-close rule.
    const rows = history
        .filter((session) => openIds.has(session.id) || !isSessionHusk(session, allMessages))
        .map((session) => ({
            session,
            label: session.title || firstUserText(allMessages[session.id]) || "Untitled chat",
        }))
    const filtered = q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows

    return (
        <MotionConfig reducedMotion="user">
            <div
                className={clsx(
                    "ag-panel-raised flex h-full min-h-0 flex-col border-0 border-r border-solid border-[var(--ag-surface-divider)]",
                    className,
                )}
            >
                <div className="flex h-[48px] shrink-0 items-center justify-between gap-2 border-0 border-b border-solid border-[var(--ag-surface-divider)] px-3">
                    <span className="text-xs font-medium text-colorTextSecondary">Sessions</span>
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
                                onClick={() => addSession()}
                                disabled={addDisabled}
                                className="!h-7 !w-7 !min-w-0 shrink-0 !p-0"
                            />
                        </span>
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
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
                >
                    {history.length === 0 && (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={<span className="text-xs">No sessions yet</span>}
                            className="!my-6"
                        />
                    )}
                    {history.length > 0 && filtered.length === 0 && (
                        <div className="px-2 py-6 text-center text-xs text-colorTextTertiary">
                            No matching sessions
                        </div>
                    )}
                    {/* Always mounted so the last row (delete/filter-to-empty) still plays its exit. */}
                    <AnimatePresence initial={false}>
                        {filtered.map(({session, label}) => (
                            <SessionRailRow
                                key={session.id}
                                session={session}
                                label={label}
                                active={session.id === currentActiveId}
                                onSelect={() => openSession(session.id)}
                                onDelete={() => deleteSession(session.id)}
                                onRename={(title) => renameSession({id: session.id, title})}
                            />
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </MotionConfig>
    )
}

export default SessionRail
