import {useMemo} from "react"

import {rowsFromPages, useSessionList} from "@agenta/sessions/state"
import {atom, useAtomValue} from "jotai"

import {readBuilderChats} from "./builderChatLink"

/** Moves when this browser links a new chat to an agent, so the lists read the link again. */
export const builderChatLinkVersionAtom = atom(0)

const NO_EXPANSIONS = [] as const

/** A builder chat as the panel lists it: one row of the sessions query. */
export interface BuilderChatRow {
    session_id: string
    name?: string | null
    updated_at?: string | null
    flags?: {is_running?: boolean | null} | null
}

/**
 * The stored builder chats of one agent, as the sessions query returns them: newest activity
 * first, with the title search of the query. No stored chat: no request.
 *
 * One request returns every stored chat: the query answers an id set in one page (it pages only
 * past the set's size), and the link keeps at most 50 chats per agent. A stored chat that is
 * deleted, archived or no longer readable is not returned, so it shows nowhere.
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
    const sessionIds = useMemo(
        () => readBuilderChats(userId, projectId, agentId),
        // The version is the signal that the link changed in this browser.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [userId, projectId, agentId, version],
    )
    // Sorted for the request: the server orders by activity, and a chat moving to the front of
    // the link must not mint a new query.
    const requestIds = useMemo(() => [...sessionIds].sort(), [sessionIds])
    const hasChats = sessionIds.length > 0
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
    const rows = useMemo<BuilderChatRow[]>(() => rowsFromPages(pages), [pages])

    return {
        sessionIds,
        rows,
        /** Waiting for the first answer of a query that runs. */
        pending: hasChats && list.isPending,
        /** The rows shown answer an earlier search while this one loads. */
        refreshing: hasChats && list.isPlaceholderData,
        failed: hasChats && failed,
        retry: () => void list.refetch(),
    }
}
