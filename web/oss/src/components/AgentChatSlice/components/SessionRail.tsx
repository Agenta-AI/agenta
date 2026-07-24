import {memo, useCallback, useRef, useState} from "react"

import {
    Archive,
    ArrowCounterClockwise,
    CaretRight,
    MagnifyingGlass,
    PencilSimple,
    Plus,
    Trash,
} from "@phosphor-icons/react"
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
    archiveSessionAtomFamily,
    archivedSessionHistoryAtomFamily,
    deleteSessionAtomFamily,
    firstUserText,
    isSessionHusk,
    openSessionAtomFamily,
    openSessionIdsAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
    timeAgo,
    unarchiveSessionAtomFamily,
} from "../state/sessions"

import SessionTabLabel, {type SessionTabLabelHandle} from "./SessionTabLabel"
import {SessionStatusDot} from "./SessionTagBar"

// Static icon elements: an inline `<Icon />` prop is a fresh element every render, which defeats
// antd Button's own memoization and shows up as a changed `icon` prop on every row.
const PENCIL_ICON = <PencilSimple size={12} />
const TRASH_ICON = <Trash size={12} />
const ARCHIVE_ICON = <Archive size={12} />
const RESTORE_ICON = <ArrowCounterClockwise size={12} />

// Stable no-op for an archived row's `onSelect` (archived rows aren't openable) — keeps the
// id-taking setter identity stable so the memoized row doesn't re-render.
const NOOP = () => {}

interface SessionRailRowProps {
    session: AgentChatSession
    label: string
    active: boolean
    // Id-taking so the parent can pass stable setters; a per-row closure would change identity
    // every render and re-render the whole row (Tooltip/Button/status-dot subtree) with it.
    onSelect: (id: string) => void
    onDelete: (id: string) => void
    onRename: (id: string, title: string) => void
    onArchive: (id: string) => void
    onUnarchive: (id: string) => void
    /** Archived rows swap the rename/archive actions for a single restore action. */
    archived?: boolean
}

/** History row: status dot, label (double-click or pencil to rename), timestamp, with an inspect
 * action on the active row and hover-revealed rename/archive/delete; collapses its height + gap
 * margin on enter/exit so nothing snaps. */
const SessionRailRow = memo(function SessionRailRow({
    session,
    label,
    active,
    onSelect,
    onDelete,
    onRename,
    onArchive,
    onUnarchive,
    archived = false,
}: SessionRailRowProps) {
    const labelRef = useRef<SessionTabLabelHandle>(null)
    // Hide the action cluster while the inline rename input owns the row, so it gets full width.
    const [renaming, setRenaming] = useState(false)
    // The rename/delete cluster is hover-only. Mount it on hover/focus instead of rendering it
    // hidden behind `opacity-0`: each button drags a Tooltip + Trigger + icon subtree, and a full
    // history of rows paid all of that on boot for pixels nobody sees.
    const [hot, setHot] = useState(false)
    const onEnter = useCallback(() => setHot(true), [])
    const onLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        // Don't unmount the cluster out from under keyboard focus: a mixed mouse+keyboard user
        // can tab into a button, then move the mouse off the row. Symmetric with onBlurRow.
        if (!e.currentTarget.contains(document.activeElement)) setHot(false)
    }, [])
    const onBlurRow = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        // Keep the cluster while focus moves INTO it (row → rename button).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(false)
    }, [])
    const sessionId = session.id
    const handleSelect = useCallback(() => onSelect(sessionId), [onSelect, sessionId])
    const handleDelete = useCallback(() => onDelete(sessionId), [onDelete, sessionId])
    const handleRename = useCallback(
        (title: string) => onRename(sessionId, title),
        [onRename, sessionId],
    )
    const startRename = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        labelRef.current?.startEditing()
    }, [])
    const confirmDelete = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            handleDelete()
        },
        [handleDelete],
    )
    const handleArchive = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            onArchive(sessionId)
        },
        [onArchive, sessionId],
    )
    const handleUnarchive = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            onUnarchive(sessionId)
        },
        [onUnarchive, sessionId],
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
                onClick={handleSelect}
                onKeyDown={onKeyDown}
                onMouseEnter={onEnter}
                onMouseLeave={onLeave}
                onFocus={onEnter}
                onBlur={onBlurRow}
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
                        onRename={handleRename}
                        onEditingChange={setRenaming}
                        className={clsx(
                            "block min-w-0 truncate text-xs",
                            active ? "text-colorText" : "text-colorTextSecondary",
                        )}
                    />
                    {(session.ended || timeAgo(session.createdAt)) && (
                        <span className="flex items-center gap-1.5 text-[11px] text-colorTextTertiary">
                            {session.ended && (
                                <span className="rounded bg-colorFillTertiary px-1 text-[10px] leading-4">
                                    Ended
                                </span>
                            )}
                            {timeAgo(session.createdAt)}
                        </span>
                    )}
                </div>
                {hot && !renaming && (
                    <div className="flex shrink-0 items-center gap-0.5">
                        {/* Inspection is build-mode only, so the chat-mode rail has no inspect entry. */}
                        {archived ? (
                            <Tooltip title="Unarchive session">
                                <Button
                                    type="text"
                                    aria-label="Unarchive session"
                                    icon={RESTORE_ICON}
                                    onClick={handleUnarchive}
                                    className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                                />
                            </Tooltip>
                        ) : (
                            <>
                                <Tooltip title="Rename session">
                                    <Button
                                        type="text"
                                        aria-label="Rename session"
                                        icon={PENCIL_ICON}
                                        onClick={startRename}
                                        className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                                    />
                                </Tooltip>
                                <Tooltip title="Archive session">
                                    <Button
                                        type="text"
                                        aria-label="Archive session"
                                        icon={ARCHIVE_ICON}
                                        onClick={handleArchive}
                                        className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                                    />
                                </Tooltip>
                            </>
                        )}
                        <Tooltip title="Delete session">
                            <Button
                                type="text"
                                aria-label="Delete session"
                                icon={TRASH_ICON}
                                onClick={confirmDelete}
                                className="!h-5 !w-5 !min-w-0 shrink-0 !p-0"
                            />
                        </Tooltip>
                    </div>
                )}
            </div>
        </motion.div>
    )
})

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
 * directly reachable. Clicking a row reopens it as the active tab; rename inline, archive/delete.
 */
const SessionRail = ({activeId, addDisabled = false, className}: SessionRailProps) => {
    const scope = useChatScopeKey()
    const history = useAtomValue(sessionHistoryAtomFamily(scope))
    const archivedHistory = useAtomValue(archivedSessionHistoryAtomFamily(scope))
    const openIds = useAtomValue(openSessionIdsAtomFamily(scope))
    const allMessages = useAtomValue(sessionMessagesAtom)
    const resolvedActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    const openSession = useSetAtom(openSessionAtomFamily(scope))
    const addSession = useSetAtom(addSessionAtomFamily(scope))
    const deleteSession = useSetAtom(deleteSessionAtomFamily(scope))
    const renameSession = useSetAtom(renameSessionAtomFamily(scope))
    const archiveSession = useSetAtom(archiveSessionAtomFamily(scope))
    const unarchiveSession = useSetAtom(unarchiveSessionAtomFamily(scope))

    const [query, setQuery] = useState("")
    const [showArchived, setShowArchived] = useState(false)
    const q = query.trim().toLowerCase()
    // `openSession`/`deleteSession`/`archiveSession`/`unarchiveSession` are already stable id-taking
    // setters; rename needs a wrapper to reshape its two args into the atom's payload.
    const handleRename = useCallback(
        (id: string, title: string) => renameSession({id, title}),
        [renameSession],
    )
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

    const archivedRows = archivedHistory.map((session) => ({
        session,
        label: session.title || firstUserText(allMessages[session.id]) || "Untitled chat",
    }))
    const filteredArchived = q
        ? archivedRows.filter((r) => r.label.toLowerCase().includes(q))
        : archivedRows

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
                                onSelect={openSession}
                                onDelete={deleteSession}
                                onRename={handleRename}
                                onArchive={archiveSession}
                                onUnarchive={unarchiveSession}
                            />
                        ))}
                    </AnimatePresence>

                    {filteredArchived.length > 0 && (
                        <div className="mt-1 flex flex-col">
                            <button
                                type="button"
                                onClick={() => setShowArchived((v) => !v)}
                                className="flex cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[11px] text-colorTextTertiary transition-colors hover:bg-colorFillTertiary"
                            >
                                <CaretRight
                                    size={10}
                                    className={clsx(
                                        "transition-transform",
                                        showArchived && "rotate-90",
                                    )}
                                />
                                Archived ({filteredArchived.length})
                            </button>
                            <AnimatePresence initial={false}>
                                {showArchived &&
                                    filteredArchived.map(({session, label}) => (
                                        <SessionRailRow
                                            key={session.id}
                                            session={session}
                                            label={label}
                                            active={false}
                                            archived
                                            onSelect={NOOP}
                                            onDelete={deleteSession}
                                            onRename={handleRename}
                                            onArchive={archiveSession}
                                            onUnarchive={unarchiveSession}
                                        />
                                    ))}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </div>
        </MotionConfig>
    )
}

export default SessionRail
