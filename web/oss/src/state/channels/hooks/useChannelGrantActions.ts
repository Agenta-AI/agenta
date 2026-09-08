import {useCallback} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    createChannelGrant,
    deleteChannelGrant,
    editChannelGrant,
    setChannelGrantDefault,
} from "../api"

/**
 * Grant create/edit/delete/set-default. `setDefault` is a dedicated action —
 * the create/edit forms never expose a raw `is_default` toggle, matching
 * `useChannelAgentActions`.
 */
export const useChannelGrantActions = () => {
    const queryClient = useAtomValue(queryClientAtom)

    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["channels", "grants"]})
    }, [queryClient])

    const create = useCallback(
        async (grant: AgentaApi.ChannelGrantCreate) => {
            const result = await createChannelGrant(grant)
            invalidate()
            return result
        },
        [invalidate],
    )

    const edit = useCallback(
        async (grantId: string, grant: AgentaApi.ChannelGrantEdit) => {
            const result = await editChannelGrant(grantId, grant)
            invalidate()
            return result
        },
        [invalidate],
    )

    const remove = useCallback(
        async (grantId: string) => {
            await deleteChannelGrant(grantId)
            invalidate()
        },
        [invalidate],
    )

    const setDefault = useCallback(
        async (grantId: string) => {
            const result = await setChannelGrantDefault(grantId)
            invalidate()
            return result
        },
        [invalidate],
    )

    return {create, edit, remove, setDefault}
}
