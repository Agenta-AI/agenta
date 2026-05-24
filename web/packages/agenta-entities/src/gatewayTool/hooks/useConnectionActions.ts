import {useCallback} from "react"

import {queryClient} from "@agenta/shared/api"

import {deleteToolConnection, refreshToolConnection, revokeToolConnection} from "../api"

const invalidateConnections = () => {
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
}

export const useConnectionActions = () => {
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
