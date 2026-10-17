import {CaretRight} from "@phosphor-icons/react"

import type {EmbedConversation} from "./embedClient"

const formatStarted = (createdAt: string | null | undefined): string => {
    if (!createdAt) return "Conversation"
    const date = new Date(createdAt)
    return Number.isNaN(date.getTime())
        ? "Conversation"
        : date.toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})
}

/** The visitor's conversations on this embed, newest first. Opening one reopens it. */
export const EmbedConversationList = ({
    conversations,
    currentSessionId,
    onOpen,
}: {
    conversations: EmbedConversation[]
    currentSessionId: string | null
    onOpen: (conversation: EmbedConversation) => void
}) => (
    <nav aria-label="Conversations" className="flex flex-col p-2">
        {conversations.map((conversation) => {
            const open = conversation.session_id === currentSessionId
            return (
                <button
                    key={conversation.session_id}
                    type="button"
                    aria-current={open ? "true" : undefined}
                    onClick={() => onOpen(conversation)}
                    className="flex items-center gap-2 rounded-md px-3 py-2.5 text-left text-xs text-foreground hover:bg-accent aria-[current=true]:bg-muted"
                >
                    <span className="grow">{formatStarted(conversation.created_at)}</span>
                    {open ? <span className="text-muted-foreground">Open</span> : null}
                    <CaretRight size={12} className="text-muted-foreground" />
                </button>
            )
        })}
    </nav>
)
