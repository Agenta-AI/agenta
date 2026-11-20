import {useEffect, useMemo} from "react"

import {rowsFromPages, useSessionList} from "@agenta/sessions/state"
import {atom, useAtomValue} from "jotai"

import {forgetBuilderChats, readBuilderChats} from "./builderChatLink"
import type {BuilderChatRow} from "./openRule"

/** Moves when this browser links a chat to an agent, so the lists read the link again. */
export const builderChatLinkVersionAtom = atom(0)

const NO_EXPANSIONS = [] as const

/**
 * The stored builder chats of one agent, as the sessions query returns them: newest activity
 * first, `limit` per page, with the title search of the query. No stored chat: no request.
 */
export const useBuilderChatList = ({
    userId,
    projectId,
    agentId,
    limit,
    search = "",
    enabled = true,
}: {
    userId: string
    projectId: string
    agentId: string
    limit: number
    search?: string
    enabled?: boolean
}) => {
    const version = useAtomValue(builderChatLinkVersionAtom)
    const chatIds = useMemo(
        () => readBuilderChats(userId, projectId, agentId),
        // The version is the signal that the link changed in this browser.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [userId, projectId, agentId, version],
    )
    const hasChats = chatIds.length > 0
    const list = useSessionList({
        originPolicy: "all",
        expansions: NO_EXPANSIONS,
        sessionIds: hasChats ? chatIds : undefined,
        search: search.trim(),
        limit,
        enabled: enabled && hasChats,
    })
    const pages = list.data?.pages
    // A page the server refused comes back as null; the list then failed.
    const failed = list.isError || Boolean(pages?.some((page) => page === null))
    // Only this agent's chats: a list kept on screen while the next one loads may hold another's.
    const rows = useMemo<BuilderChatRow[]>(
        () => rowsFromPages(pages).filter((row) => chatIds.includes(row.session_id)),
        [pages, chatIds],
    )

    // One full unfiltered first page that is short means every other stored id is gone: deleted,
    // or no longer readable. Those leave the link.
    const complete =
        !search.trim() &&
        !list.isPlaceholderData &&
        pages?.length === 1 &&
        !failed &&
        rows.length < limit
    useEffect(() => {
        if (!complete) return
        const returned = new Set(rows.map((row) => row.session_id))
        forgetBuilderChats(
            userId,
            projectId,
            agentId,
            chatIds.filter((id) => !returned.has(id)),
        )
    }, [complete, rows, chatIds, userId, projectId, agentId])

    return {
        chatIds,
        rows,
        /** Waiting for the first answer of a query that runs. */
        pending: hasChats && enabled && list.isPending,
        /** The rows shown are an earlier list's while this one loads. */
        stale: hasChats && enabled && list.isPlaceholderData,
        failed: hasChats && failed,
        retry: () => void list.refetch(),
        hasMore: Boolean(list.hasNextPage),
        loadingMore: list.isFetchingNextPage,
        loadMore: () => void list.fetchNextPage(),
    }
}
