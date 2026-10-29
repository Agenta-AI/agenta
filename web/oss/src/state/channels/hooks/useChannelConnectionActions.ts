import {useCallback} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {createChannelConnection} from "../api"

// The service verifies before it writes: a rejected credential throws, and invalidate() is never reached.
export const useChannelConnectionActions = () => {
    const queryClient = useAtomValue(queryClientAtom)

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["channels", "connections"]})
    }, [queryClient])

    const create = useCallback(
        async (connection: AgentaApi.ChannelConnectionCreate) => {
            const result = await createChannelConnection(connection)
            invalidate()
            return result
        },
        [invalidate],
    )

    return {create}
}
