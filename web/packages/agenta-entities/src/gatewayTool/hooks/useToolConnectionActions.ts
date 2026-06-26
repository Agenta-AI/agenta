import {useCallback} from "react"

import {queryClient} from "@agenta/shared/api"

import {deleteToolConnection, refreshToolConnection, revokeToolConnection} from "../api"

// Tools and triggers are independent surfaces over the SAME shared
// `gateway_connections` rows, so a write here must also invalidate the triggers
// list — otherwise a connection removed from tools would read as stale there.
const invalidateConnections = () => {
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
    queryClient.invalidateQueries({queryKey: ["triggers", "connections"]})
}

export const useToolConnectionActions = () => {
    const handleDelete = useCallback(async (connectionId: string) => {
        await deleteToolConnection(connectionId)
        invalidateConnections()
    }, [])

    const handleRefresh = useCallback(async (connectionId: string, force?: boolean) => {
        const result = await refreshToolConnection(connectionId, force)
        invalidateConnections()
        return result
    }, [])

    const handleRevoke = useCallback(async (connectionId: string) => {
        const result = await revokeToolConnection(connectionId)
        invalidateConnections()
        return result
    }, [])

    return {handleDelete, handleRefresh, handleRevoke, invalidateConnections}
}
