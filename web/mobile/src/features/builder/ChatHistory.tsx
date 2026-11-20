import {useDeferredValue, useEffect, useRef, useState} from "react"

import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"
import {SearchInput, SkeletonRows} from "@agenta/ui/ui"

import {ChatListFailed, ChatRow} from "./ChatRows"
import type {BuilderChatRow} from "./openRule"
import {useBuilderChatList} from "./useBuilderChatList"

/** One page of "Chat history". */
const HISTORY_PAGE = 30

/** What "Chat history" shows, for a list in any state. */
export interface ChatHistoryListProps {
    rows: readonly BuilderChatRow[]
    pending: boolean
    failed: boolean
    /** The search the rows answer. */
    search: string
    onSearch: (search: string) => void
    onRetry: () => void
    onOpen: (chatId: string) => void
    hasMore?: boolean
    loadingMore?: boolean
    loadMore?: () => void
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
    hasMore = false,
    loadingMore = false,
    loadMore,
}: ChatHistoryListProps) => {
    const t = useT(builderPanelCatalog)
    const now = Date.now()

    // The next page loads when the end of the list comes into view.
    const endRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const end = endRef.current
        if (!end || !hasMore || !loadMore || typeof IntersectionObserver === "undefined") return
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting) && !loadingMore) loadMore()
        })
        observer.observe(end)
        return () => observer.disconnect()
    }, [hasMore, loadingMore, loadMore])

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
                {loadingMore ? <SkeletonRows count={2} rowClassName="h-8 rounded-md" /> : null}
                <div ref={endRef} className="h-px shrink-0" />
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
 * of the sessions query, and the next page when the reader scrolls to the end.
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
    onOpen: (chatId: string) => void
}) => {
    const [search, setSearch] = useState("")
    const query = useDeferredValue(search)
    const list = useBuilderChatList({
        userId,
        projectId,
        agentId,
        limit: HISTORY_PAGE,
        search: query,
    })
    return (
        <ChatHistoryList
            rows={list.rows}
            pending={list.pending}
            failed={list.failed}
            search={search}
            onSearch={setSearch}
            onRetry={list.retry}
            onOpen={onOpen}
            hasMore={list.hasMore}
            loadingMore={list.loadingMore}
            loadMore={list.loadMore}
        />
    )
}
