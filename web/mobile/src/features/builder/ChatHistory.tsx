import {useDeferredValue, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {SearchInput, SkeletonRows} from "@agenta/ui/ui"

import {ChatListFailed, ChatRow} from "./ChatRows"
import type {BuilderChatRow} from "./useBuilderChatList"
import {useBuilderChatList} from "./useBuilderChatList"

/** What "Chat history" shows, for a list in any state. */
export interface ChatHistoryListProps {
    rows: readonly BuilderChatRow[]
    pending: boolean
    failed: boolean
    /** The search the rows answer. */
    search: string
    onSearch: (search: string) => void
    onRetry: () => void
    onOpen: (sessionId: string) => void
}

/** The search field and the rows of "Chat history", newest first. */
export const ChatHistoryList = ({
    rows,
    pending,
    failed,
    search,
    onSearch,
    onRetry,
    onOpen,
}: ChatHistoryListProps) => {
    const t = useT(builderPanelCatalog)
    const now = Date.now()

    let body
    if (pending) body = <SkeletonRows count={6} rowClassName="h-8 rounded-md" />
    else if (failed) body = <ChatListFailed onRetry={onRetry} />
    else if (rows.length === 0)
        body = (
            <p className="m-0 px-2 py-1.5 text-xs text-colorTextSecondary">
                {search.trim() ? t("builder.panel.noChatMatches") : t("builder.panel.noChatsYet")}
            </p>
        )
    else
        body = (
            <>
                {rows.map((row) => (
                    <ChatRow key={row.session_id} row={row} now={now} onOpen={onOpen} />
                ))}
            </>
        )

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid="builder-chat-history">
            <div className="shrink-0 px-3 pt-3 pb-2">
                <SearchInput
                    value={search}
                    onChange={(event) => onSearch(event.target.value)}
                    placeholder={t("builder.panel.searchChats")}
                    aria-label={t("builder.panel.searchChats")}
                    allowClear
                />
            </div>
            <div className="ag-scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3 pb-3">
                {body}
            </div>
        </div>
    )
}

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
