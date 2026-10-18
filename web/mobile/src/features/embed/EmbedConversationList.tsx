import {CaretRight, NotePencil} from "@phosphor-icons/react"

import type {EmbedConversation} from "./embedClient"

const formatStarted = (createdAt: string | null | undefined): string => {
    if (!createdAt) return "Conversation"
    const date = new Date(createdAt)
    return Number.isNaN(date.getTime())
        ? "Conversation"
        : date.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})
}

const ROW =
    "flex items-center gap-2 rounded-md border-0 bg-transparent px-3 py-2.5 text-left text-xs text-foreground hover:bg-accent"

/** "New chat", then the visitor's conversations on this embed, newest first. Opening one reopens it. */
export const EmbedConversationList = ({
    conversations,
    currentSessionId,
    canStartNew,
    onOpen,
    onNewChat,
}: {
    conversations: EmbedConversation[]
    currentSessionId: string | null
    canStartNew: boolean
    onOpen: (conversation: EmbedConversation) => void
    onNewChat: () => void
}) => (
    <nav aria-label="Conversations" className="flex flex-col p-2">
        <button
            type="button"
            disabled={!canStartNew}
            onClick={onNewChat}
            className={`${ROW} font-medium disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent`}
        >
            <NotePencil size={14} />
            <span className="grow">New chat</span>
        </button>
        {conversations.map((conversation) => {
            const open = conversation.session_id === currentSessionId
            return (
                <button
                    key={conversation.session_id}
                    type="button"
                    aria-current={open ? "true" : undefined}
                    onClick={() => onOpen(conversation)}
                    className={`${ROW} aria-[current=true]:bg-muted`}
                >
                    <span className="grow">{formatStarted(conversation.created_at)}</span>
                    {open ? <span className="text-muted-foreground">Open</span> : null}
                    <CaretRight size={12} className="text-muted-foreground" />
                </button>
            )
        })}
    </nav>
)
