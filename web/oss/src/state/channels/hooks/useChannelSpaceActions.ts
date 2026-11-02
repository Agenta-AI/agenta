import {useCallback} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    createChannelSpace,
    deleteChannelSpace,
    discoverChannelSpaces,
    editChannelSpace,
} from "../api"

export const useChannelSpaceActions = () => {
    const queryClient = useAtomValue(queryClientAtom)

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["channels", "spaces"]})
        queryClient.invalidateQueries({queryKey: ["channels", "grants"]})
    }, [queryClient])

    const create = useCallback(
        async (space: AgentaApi.ChannelSpaceCreate) => {
            const result = await createChannelSpace(space)
            invalidate()
            return result
        },
        [invalidate],
    )

    const edit = useCallback(
        async (spaceId: string, space: AgentaApi.ChannelSpaceEdit) => {
            const result = await editChannelSpace(spaceId, space)
            invalidate()
            return result
        },
        [invalidate],
    )

    const remove = useCallback(
        async (spaceId: string) => {
            await deleteChannelSpace(spaceId)
            invalidate()
        },
        [invalidate],
    )

    const discover = useCallback((connectionId: string) => discoverChannelSpaces(connectionId), [])

    return {create, edit, remove, discover}
}
