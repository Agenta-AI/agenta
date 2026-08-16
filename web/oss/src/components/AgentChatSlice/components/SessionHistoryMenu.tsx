import {useState} from "react"

import {sessionMessagesAtom} from "@agenta/chat/state"
import {killSession} from "@agenta/entities/session"
import {message, modal} from "@agenta/ui/app-message"
import {
    Button,
    EmptyState,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    Archive,
    ArrowCounterClockwise,
    CaretRight,
    ClockCounterClockwise,
    Power,
    Trash,
} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {sessionLivenessAtomFamily} from "../state/liveness"
import {useChatScopeKey} from "../state/scope"
import {
    type AgentChatSession,
    archiveSessionAtomFamily,
    archivedSessionHistoryAtomFamily,
    deleteSessionAtomFamily,
    firstUserText,
    openSessionAtomFamily,
    sessionHistoryAtomFamily,
    timeAgo,
    unarchiveSessionAtomFamily,
} from "../state/sessions"

import {SessionStatusDot} from "./SessionTagBar"

/**
 * One history row. Reads this session's backend liveness so it can (a) show the same status dot as
 * the tabs and (b) offer "End session" (kill) ONLY when the session is actually alive on the backend
 * — tearing down its sandbox. Distinct from Delete, which only drops the LOCAL history/messages.
 */
const SessionHistoryRow = ({
    session,
    label,
    onOpen,
    onDelete,
    onArchive,
    onUnarchive,
    archived = false,
}: {
    session: AgentChatSession
    label: string
    onOpen: () => void
    onDelete: () => void
    onArchive: () => void
    onUnarchive: () => void
    archived?: boolean
}) => {
    const projectId = useAtomValue(projectIdAtom)
    const queryClient = useQueryClient()
    const {nest} = useAtomValue(sessionLivenessAtomFamily(session.id))
    const [killing, setKilling] = useState(false)

    const endSession = async () => {
        setKilling(true)
        try {
            const ok = await killSession({sessionId: session.id, projectId: projectId ?? ""})
            if (ok) {
                message.success("Session ended")
                // Refresh the shared liveness query so this row's dot + action update at once.
                queryClient.invalidateQueries({queryKey: ["session-liveness"]})
            } else {
                message.error("Couldn't end session")
            }
        } finally {
            setKilling(false)
        }
    }

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onOpen}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpen()
                }
            }}
            className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-colorFillTertiary"
        >
            <SessionStatusDot sessionId={session.id} />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-colorText" title={label}>
                    {label}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-colorTextSecondary">
                    {archived && (
                        <span className="rounded bg-colorFillTertiary px-1 text-[10px] leading-4">
                            Archived
                        </span>
                    )}
                    {session.ended && (
                        <span className="rounded bg-colorFillTertiary px-1 text-[10px] leading-4">
                            Ended
                        </span>
                    )}
                    {timeAgo(session.lastMessageAt ?? session.createdAt)}
                </span>
            </div>
            {!archived && nest.isAlive && (
                <SimpleTooltip title="End session">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="End session"
                        disabled={killing}
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation()
                            modal.confirm({
                                title: "End this session?",
                                content: "The agent's sandbox will be torn down.",
                                okText: "End session",
                                okButtonProps: {danger: true},
                                onOk: endSession,
                            })
                        }}
                    >
                        <Power size={14} />
                    </Button>
                </SimpleTooltip>
            )}
            {archived ? (
                <SimpleTooltip title="Unarchive session">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Unarchive session"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation()
                            onUnarchive()
                        }}
                    >
                        <ArrowCounterClockwise size={14} />
                    </Button>
                </SimpleTooltip>
            ) : (
                <SimpleTooltip title="Archive session">
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Archive session"
                        className="opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation()
                            onArchive()
                        }}
                    >
                        <Archive size={14} />
                    </Button>
                </SimpleTooltip>
            )}
            <SimpleTooltip title="Delete session">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete session"
                    className="opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                >
                    <Trash size={14} />
                </Button>
            </SimpleTooltip>
        </div>
    )
}

/**
 * The scrollable history list. Rendered as Popover content (so it only mounts — and only
 * subscribes to `sessionMessagesAtom` for its labels — while the popover is open). Clicking a
 * row reopens that session as a tab (or focuses it if already open); the trash icon deletes it
 * permanently (tab + history + messages).
 */
const SessionHistoryList = ({onPicked}: {onPicked: () => void}) => {
    const scope = useChatScopeKey()
    const history = useAtomValue(sessionHistoryAtomFamily(scope))
    const archivedHistory = useAtomValue(archivedSessionHistoryAtomFamily(scope))
    const allMessages = useAtomValue(sessionMessagesAtom)
    const openSession = useSetAtom(openSessionAtomFamily(scope))
    const deleteSession = useSetAtom(deleteSessionAtomFamily(scope))
    const archiveSession = useSetAtom(archiveSessionAtomFamily(scope))
    const unarchiveSession = useSetAtom(unarchiveSessionAtomFamily(scope))
    const [showArchived, setShowArchived] = useState(false)

    const labelOf = (session: AgentChatSession) =>
        session.title || firstUserText(allMessages[session.id]) || "Untitled chat"

    if (history.length === 0 && archivedHistory.length === 0) {
        return (
            <EmptyState
                image="simple"
                description={<span className="text-xs">No sessions yet</span>}
                className="my-2"
            />
        )
    }

    return (
        <div className="flex max-h-80 w-72 flex-col overflow-y-auto">
            {history.map((session) => (
                <SessionHistoryRow
                    key={session.id}
                    session={session}
                    label={labelOf(session)}
                    onOpen={() => {
                        openSession(session.id)
                        onPicked()
                    }}
                    onDelete={() => deleteSession(session.id)}
                    onArchive={() => archiveSession(session.id)}
                    onUnarchive={() => unarchiveSession(session.id)}
                />
            ))}

            {archivedHistory.length > 0 && (
                <>
                    <button
                        type="button"
                        onClick={() => setShowArchived((v) => !v)}
                        className="mt-1 flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-2 py-1.5 text-left text-[11px] text-colorTextTertiary transition-colors hover:bg-colorFillTertiary"
                    >
                        <CaretRight
                            size={10}
                            className={clsx("transition-transform", showArchived && "rotate-90")}
                        />
                        Archived ({archivedHistory.length})
                    </button>
                    {showArchived &&
                        archivedHistory.map((session) => (
                            <SessionHistoryRow
                                key={session.id}
                                session={session}
                                label={labelOf(session)}
                                archived
                                onOpen={() => undefined}
                                onDelete={() => deleteSession(session.id)}
                                onArchive={() => archiveSession(session.id)}
                                onUnarchive={() => unarchiveSession(session.id)}
                            />
                        ))}
                </>
            )}
        </div>
    )
}

/**
 * History picker for the agent-chat tab bar: a clock button that opens the list of all past
 * sessions for the current app (open + closed) so closed conversations can be reopened. Lives
 * in the Tabs' `tabBarExtraContent` so it sits beside the `+` add control.
 */
const SessionHistoryMenu = () => {
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Session history">
                    <ClockCounterClockwise size={16} />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex flex-col gap-1 p-2">
                <span className="px-2 pt-1 text-xs font-medium">Session history</span>
                <SessionHistoryList onPicked={() => setOpen(false)} />
            </PopoverContent>
        </Popover>
    )
}

export default SessionHistoryMenu
