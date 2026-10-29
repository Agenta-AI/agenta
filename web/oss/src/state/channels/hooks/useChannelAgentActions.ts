import {useCallback} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    createChannelAgent,
    deleteChannelAgent,
    editChannelAgent,
    setChannelAgentDefault,
} from "../api"

/**
 * Agent create/edit/delete/set-default. `setDefault` is a dedicated action
 * (never a raw `is_default` field on the edit form) so a default flip always
 * goes through `set_channel_agent_default`, per the house discipline that
 * the connection-wide fallback flag is not a generic PUT field.
 */
export const useChannelAgentActions = () => {
    const queryClient = useAtomValue(queryClientAtom)

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["channels", "agents"]})
        queryClient.invalidateQueries({queryKey: ["channels", "grants"]})
    }, [queryClient])

    const create = useCallback(
        async (agent: AgentaApi.ChannelAgentCreate) => {
            const result = await createChannelAgent(agent)
            invalidate()
            return result
        },
        [invalidate],
    )

    const edit = useCallback(
        async (agentId: string, agent: AgentaApi.ChannelAgentEdit) => {
            const result = await editChannelAgent(agentId, agent)
            invalidate()
            return result
        },
        [invalidate],
    )

    const remove = useCallback(
        async (agentId: string) => {
            await deleteChannelAgent(agentId)
            invalidate()
        },
        [invalidate],
    )

    const setDefault = useCallback(
        async (agentId: string) => {
            const result = await setChannelAgentDefault(agentId)
            invalidate()
            return result
        },
        [invalidate],
    )

    return {create, edit, remove, setDefault}
}
