import {Plus, X} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    type AgentChatSession,
    type SessionRunStatus,
    sessionFirstUserTextAtomFamily,
    sessionStatusAtomFamily,
} from "../state/sessions"

import SessionTabLabel from "./SessionTabLabel"

const STATUS_META: Record<SessionRunStatus, {dot: string; pulse: boolean; title: string}> = {
    running: {dot: "bg-colorInfo", pulse: true, title: "Running"},
    awaiting: {dot: "bg-colorWarning", pulse: true, title: "Waiting for approval"},
    error: {dot: "bg-colorError", pulse: false, title: "Last run failed"},
    idle: {dot: "bg-colorTextQuaternary", pulse: false, title: "Idle"},
}

/** A session's run-state dot. Subscribes to just that session's status atom so a streaming
 * conversation repaints only its own dot, never the whole bar. */
export const SessionStatusDot = ({sessionId}: {sessionId: string}) => {
    const status = useAtomValue(sessionStatusAtomFamily(sessionId))
    const meta = STATUS_META[status]
    return (
        <span className="relative flex h-1.5 w-1.5 shrink-0" title={meta.title}>
            {meta.pulse && (
                <span
                    className={clsx(
                        "absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping",
                        meta.dot,
                    )}
                />
            )}
            <span className={clsx("relative inline-flex h-1.5 w-1.5 rounded-full", meta.dot)} />
        </span>
    )
}

interface SessionTagProps {
    session: AgentChatSession
    index: number
    active: boolean
    closable: boolean
    onSelect: () => void
    onClose: () => void
    onRename: (title: string) => void
}

/** One session chip: status dot + truncated label (double-click to rename) + hover close. */
const SessionTag = ({
    session,
    index,
    active,
    closable,
    onSelect,
    onClose,
    onRename,
}: SessionTagProps) => {
    const text = useAtomValue(sessionFirstUserTextAtomFamily(session.id))
    const label = session.title || text || `Chat ${index + 1}`
    return (
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
                "group flex h-7 max-w-[180px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 text-xs transition-colors",
                active
                    ? "border-colorBorder bg-colorFillSecondary text-colorText"
                    : "border-colorBorderSecondary bg-transparent text-colorTextSecondary hover:bg-colorFillTertiary hover:text-colorText",
            )}
        >
            <SessionStatusDot sessionId={session.id} />
            <SessionTabLabel
                label={label}
                onRename={onRename}
                className="block min-w-0 flex-1 truncate"
            />
            {closable && (
                <Button
                    type="text"
                    aria-label="Close session"
                    icon={<X size={12} />}
                    onClick={(e) => {
                        e.stopPropagation()
                        onClose()
                    }}
                    className="!h-5 !w-5 !min-w-0 shrink-0 !p-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                />
            )}
        </div>
    )
}

export interface SessionTagBarProps {
    sessions: AgentChatSession[]
    activeId?: string
    onSelect: (id: string) => void
    onAdd: () => void
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
    onClose,
    onRename,
    extra,
    showSessions = true,
}: SessionTagBarProps) => {
    const closable = sessions.length > 1
    return (
        <div className="flex h-[48px] shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3">
            {showSessions ? (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {sessions.map((session, index) => (
                        <SessionTag
                            key={session.id}
                            session={session}
                            index={index}
                            active={session.id === activeId}
                            closable={closable}
                            onSelect={() => onSelect(session.id)}
                            onClose={() => onClose(session.id)}
                            onRename={(title) => onRename(session.id, title)}
                        />
                    ))}
                    <Tooltip title="New session">
                        <Button
                            type="text"
                            aria-label="New session"
                            icon={<Plus size={14} />}
                            onClick={onAdd}
                            className="!h-7 !w-7 !min-w-0 shrink-0 !p-0"
                        />
                    </Tooltip>
                </div>
            ) : (
                <div className="min-w-0 flex-1" />
            )}
            {extra && <div className="flex shrink-0 items-center gap-1">{extra}</div>}
        </div>
    )
}

export default SessionTagBar
