import {useCallback} from "react"

import {queryClient} from "@agenta/shared/api"

import {deleteTriggerConnection, refreshTriggerConnection, revokeTriggerConnection} from "../api"

// Tools and triggers are independent surfaces over the SAME shared
// `gateway_connections` rows, so a write on either side must invalidate BOTH
// caches — otherwise a connection created/removed from triggers would read as
// stale on the tools list (and vice-versa).
const invalidateConnections = () => {
    queryClient.invalidateQueries({queryKey: ["triggers", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
}

export const useTriggerConnectionActions = () => {
    const handleDelete = useCallback(async (connectionId: string) => {
        await deleteTriggerConnection(connectionId)
        invalidateConnections()
    }, [])

    const handleRefresh = useCallback(async (connectionId: string, force?: boolean) => {
        const result = await refreshTriggerConnection(connectionId, force)
        invalidateConnections()
        return result
    }, [])

    const handleRevoke = useCallback(async (connectionId: string) => {
        const result = await revokeTriggerConnection(connectionId)
        invalidateConnections()
        return result
    }, [])

    return {handleDelete, handleRefresh, handleRevoke, invalidateConnections}
}
