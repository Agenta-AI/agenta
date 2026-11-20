import {useMemo} from "react"

import {builderAgentRevisionIdQueryAtom, workflowMolecule} from "@agenta/entities/workflow"
import {rowsFromPages, useSessionList} from "@agenta/sessions/state"
import {useAtomValue} from "jotai"

import type {BuilderChatRow} from "../builder/useBuilderChatList"

const NO_EXPANSIONS = [] as const

/**
 * The person's builder chats, newest activity first: the sessions of the builder agent
 * (`__ag__builder`), from the existing session query. `search` narrows them by title on the
 * server, so it searches every chat, not only the loaded pages.
 */
export const useBuilderChats = (search = "") => {
    const builder = useAtomValue(builderAgentRevisionIdQueryAtom)
    const builderWorkflowId =
        useAtomValue(workflowMolecule.selectors.workflowId(builder.data ?? "")) || null
    const list = useSessionList({
        agentId: builderWorkflowId,
        originPolicy: "all",
        search,
        expansions: NO_EXPANSIONS,
        enabled: Boolean(builderWorkflowId),
    })
    const pages = list.data?.pages
    const rows = useMemo<BuilderChatRow[]>(() => rowsFromPages(pages), [pages])
    const failed = builder.isError || list.isError || Boolean(pages?.some((page) => page === null))
    return {
        rows,
        pending: !failed && (builder.isPending || !builderWorkflowId || list.isPending),
        failed,
        retry: () => void (builder.isError ? builder.refetch() : list.refetch()),
        loadMore: () => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage()
        },
    }
}
