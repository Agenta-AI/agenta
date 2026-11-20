import {useEffect, useMemo} from "react"

import {rowsFromPages, useSessionList} from "@agenta/sessions/state"
import {atom, useAtomValue} from "jotai"

import {forgetBuilderChats, readBuilderChats} from "./builderChatLink"
import type {BuilderChatRow} from "./openRule"

/** Moves when this browser links a new chat to an agent, so the lists read the link again. */
export const builderChatLinkVersionAtom = atom(0)

const NO_EXPANSIONS = [] as const

/**
 * The stored builder chats of one agent, as the sessions query returns them: newest activity
 * first, with the title search of the query. No stored chat: no request.
 *
 * One request returns every stored chat: the query answers an id set in one page (it pages only
 * past the set's size), and the link keeps at most 50 chats per agent.
 */
export const useBuilderChatList = ({
    userId,
    projectId,
    agentId,
    search = "",
}: {
    userId: string
    projectId: string
    agentId: string
    search?: string
}) => {
    const version = useAtomValue(builderChatLinkVersionAtom)
    const chatIds = useMemo(
        () => readBuilderChats(userId, projectId, agentId),
        // The version is the signal that the link changed in this browser.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [userId, projectId, agentId, version],
    )
    // Sorted for the request: the server orders by activity, and a chat moving to the front of
    // the link must not mint a new query.
    const requestIds = useMemo(() => [...chatIds].sort(), [chatIds])
    const hasChats = chatIds.length > 0
    const query = search.trim()
    const list = useSessionList({
        originPolicy: "all",
        expansions: NO_EXPANSIONS,
        sessionIds: hasChats ? requestIds : undefined,
        search: query,
        enabled: hasChats,
    })
    const pages = list.data?.pages
    // A page the server refused comes back as null; the list then failed.
    const failed = list.isError || Boolean(pages?.some((page) => page === null))
    // Only this agent's chats: a list kept on screen while the next one loads may hold another's.
    const rows = useMemo<BuilderChatRow[]>(
        () => rowsFromPages(pages).filter((row) => chatIds.includes(row.session_id)),
        [pages, chatIds],
    )

    // The unfiltered answer holds every stored chat the person can still read. The others are
    // deleted or no longer readable, and leave the link.
    const complete = !query && !list.isPlaceholderData && pages !== undefined && !failed
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
        pending: hasChats && list.isPending,
        /** The rows shown are an earlier list's while this one loads. */
        stale: hasChats && list.isPlaceholderData,
        failed: hasChats && failed,
        retry: () => void list.refetch(),
    }
}
