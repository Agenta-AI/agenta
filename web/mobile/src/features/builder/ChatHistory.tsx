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
    phone = false,
}: {
    userId: string
    projectId: string
    agentId: string
    onOpen: (sessionId: string) => void
    phone?: boolean
}) => {
    const [search, setSearch] = useState("")
    const query = useDeferredValue(search)
    const list = useBuilderChatList({userId, projectId, agentId, search: query})
    return (
        <ChatHistoryList
            rows={list.rows}
            // A new search with no rows on screen yet loads, rather than saying nothing matches.
            pending={list.pending || (list.refreshing && list.rows.length === 0)}
            failed={list.failed}
            search={search}
            onSearch={setSearch}
            onRetry={list.retry}
            onOpen={onOpen}
            phone={phone}
        />
    )
}
