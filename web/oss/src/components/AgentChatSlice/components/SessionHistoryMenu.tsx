import {useState} from "react"

import {ClockCounterClockwise, Trash} from "@phosphor-icons/react"
import {Button, Empty, Popover, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useChatScopeKey} from "../state/scope"
import {
    deleteSessionAtomFamily,
    firstUserText,
    openSessionAtomFamily,
    openSessionIdsAtomFamily,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
} from "../state/sessions"

const {Text} = Typography

/** Compact "2m / 3h / 5d ago" stamp; falls back to empty for pre-upgrade sessions. */
const timeAgo = (ts?: number): string => {
    if (!ts) return ""
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
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
    const openIds = useAtomValue(openSessionIdsAtomFamily(scope))
    const allMessages = useAtomValue(sessionMessagesAtom)
    const openSession = useSetAtom(openSessionAtomFamily(scope))
    const deleteSession = useSetAtom(deleteSessionAtomFamily(scope))

    if (history.length === 0) {
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
            {history.map((session) => {
                const label =
                    session.title || firstUserText(allMessages[session.id]) || "Untitled chat"
                const isOpen = openIds.has(session.id)
                return (
                    <div
                        key={session.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                            openSession(session.id)
                            onPicked()
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                openSession(session.id)
                                onPicked()
                            }
                        }}
                        className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-colorFillTertiary"
                    >
                        <div className="flex min-w-0 flex-1 flex-col">
                            <Text className="!text-xs" ellipsis={{tooltip: label}}>
                                {label}
                            </Text>
                            <Text type="secondary" className="!text-[11px]">
                                {timeAgo(session.createdAt)}
                            </Text>
                        </div>
                        {isOpen && (
                            <Tag color="processing" className="!m-0 !text-[11px]">
                                open
                            </Tag>
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
                                    deleteSession(session.id)
                                }}
                            />
                        </Tooltip>
                    </div>
                )
            })}
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
