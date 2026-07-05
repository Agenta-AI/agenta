import {useState} from "react"

import {Badge} from "@agenta/primitive-ui/components/badge"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from "@agenta/primitive-ui/components/popover"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {ClockCounterClockwise, Trash} from "@phosphor-icons/react"
import {Empty} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useChatScopeKey} from "../state/scope"
import {
    deleteSessionAtomFamily,
    firstUserText,
    openSessionAtomFamily,
    openSessionIdsAtomFamily,
    sessionHistoryAtomFamily,
    sessionMessagesAtom,
    timeAgo,
} from "../state/sessions"

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
                            <span className="!text-xs truncate" title={label}>
                                {label}
                            </span>
                            <span className="!text-[11px] text-muted-foreground">
                                {timeAgo(session.createdAt)}
                            </span>
                        </div>
                        {isOpen && (
                            <Badge className="!m-0 !text-[11px]" variant="info">
                                open
                            </Badge>
                        )}
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        aria-label="Delete session"
                                        className="!opacity-0 group-hover:!opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            deleteSession(session.id)
                                        }}
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        {<Trash size={14} />}
                                    </Button>
                                }
                            />
                            <TooltipContent>{"Delete session"}</TooltipContent>
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
 * in the session bar so it sits beside the `+` add control.
 */
const SessionHistoryMenu = () => {
    const [open, setOpen] = useState(false)
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger nativeButton={false} render={<span className="inline-flex" />}>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Button aria-label="Session history" variant="ghost" size="icon-sm">
                                {<ClockCounterClockwise size={16} />}
                            </Button>
                        }
                    />
                    <TooltipContent>{"Session history"}</TooltipContent>
                </Tooltip>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="end">
                <PopoverHeader>
                    <PopoverTitle className="text-xs">Session history</PopoverTitle>
                </PopoverHeader>
                <SessionHistoryList onPicked={() => setOpen(false)} />
            </PopoverContent>
        </Popover>
    )
}

export default SessionHistoryMenu
