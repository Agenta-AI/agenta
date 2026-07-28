import {useState} from "react"

import {killSession} from "@agenta/entities/session"
import {message} from "@agenta/ui/app-message"
import {
    Archive,
    ArrowCounterClockwise,
    CaretRight,
    ClockCounterClockwise,
    Power,
    Trash,
} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Empty, Popconfirm, Popover, Tooltip, Typography} from "antd"
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
    sessionMessagesAtom,
    timeAgo,
    unarchiveSessionAtomFamily,
} from "../state/sessions"

import {SessionStatusDot} from "./SessionTagBar"

const {Text} = Typography

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
                <Text className="!text-xs" ellipsis={{tooltip: label}}>
                    {label}
                </Text>
                <Text type="secondary" className="flex items-center gap-1.5 !text-[11px]">
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
                    {timeAgo(session.createdAt)}
                </Text>
            </div>
            {!archived && nest.isAlive && (
                <Popconfirm
                    title="End this session?"
                    description="The agent's sandbox will be torn down."
                    okText="End session"
                    okButtonProps={{danger: true, loading: killing}}
                    onConfirm={endSession}
                >
                    <Tooltip title="End session">
                        <Button
                            type="text"
                            size="small"
                            aria-label="End session"
                            className="!opacity-0 group-hover:!opacity-100"
                            icon={<Power size={14} />}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Tooltip>
                </Popconfirm>
            )}
            {archived ? (
                <Tooltip title="Unarchive session">
                    <Button
                        type="text"
                        size="small"
                        aria-label="Unarchive session"
                        className="!opacity-0 group-hover:!opacity-100"
                        icon={<ArrowCounterClockwise size={14} />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onUnarchive()
                        }}
                    />
                </Tooltip>
            ) : (
                <Tooltip title="Archive session">
                    <Button
                        type="text"
                        size="small"
                        aria-label="Archive session"
                        className="!opacity-0 group-hover:!opacity-100"
                        icon={<Archive size={14} />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onArchive()
                        }}
                    />
                </Tooltip>
            )}
            <Tooltip title="Delete session">
                <Button
                    type="text"
                    size="small"
                    aria-label="Delete session"
                    className="!opacity-0 group-hover:!opacity-100"
                    icon={<Trash size={14} />}
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                    }}
                />
            </Tooltip>
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
            <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-xs">No sessions yet</span>}
                className="!my-2"
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
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger="click"
            placement="bottomRight"
            title={<span className="text-xs font-medium">Session history</span>}
            content={<SessionHistoryList onPicked={() => setOpen(false)} />}
        >
            <Tooltip title="Session history">
                <Button
                    type="text"
                    size="small"
                    aria-label="Session history"
                    icon={<ClockCounterClockwise size={16} />}
                />
            </Tooltip>
        </Popover>
    )
}

export default SessionHistoryMenu
