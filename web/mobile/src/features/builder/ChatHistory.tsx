import {useDeferredValue, useState} from "react"

import {ChatHistoryList} from "./ChatHistoryList"
import {useBuilderChatList} from "./useBuilderChatList"

/**
 * "Chat history" in the panel: every chat about this agent, newest first, with the title search
 * of the sessions query.
 */
export const ChatHistory = ({
    userId,
    projectId,
    agentId,
    onOpen,
}: {
    userId: string
    projectId: string
    agentId: string
    onOpen: (sessionId: string) => void
}) => {
    const [search, setSearch] = useState("")
    const query = useDeferredValue(search)
    const list = useBuilderChatList({userId, projectId, agentId, search: query})
    return (
        <ChatHistoryList
            rows={list.rows}
            pending={list.pending}
            failed={list.failed}
            search={search}
            onSearch={setSearch}
            onRetry={list.retry}
            onOpen={onOpen}
        />
    )
}
