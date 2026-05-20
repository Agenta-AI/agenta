import {useCallback} from "react"

import {
    createConnection,
    deleteToolConnection,
    refreshToolConnection,
    type ToolConnectionCreatePayload,
} from "@agenta/entities/gatewayTool"
import {queryClient} from "@agenta/shared/api"

const DEFAULT_PROVIDER = "composio"

export interface CreateConnectionInput {
    slug: string
    name?: string
    description?: string
    mode?: "oauth" | "api_key"
    credentials?: Record<string, string>
}

export const useToolsConnections = (integrationKey: string) => {
    const invalidate = useCallback(() => {
        queryClient.invalidateQueries({
            queryKey: ["tools", "integrationDetail", DEFAULT_PROVIDER, integrationKey],
        })
        queryClient.invalidateQueries({
            queryKey: ["tools", "integrationConnections", DEFAULT_PROVIDER, integrationKey],
        })
        queryClient.invalidateQueries({
            queryKey: ["tools", "integrations", DEFAULT_PROVIDER],
        })
        queryClient.invalidateQueries({
            queryKey: ["tools", "connections"],
        })
    }, [integrationKey])

    const handleCreate = useCallback(
        async (payload: CreateConnectionInput) => {
            const request: ToolConnectionCreatePayload = {
                connection: {
                    slug: payload.slug,
                    name: payload.name,
                    description: payload.description,
                    provider_key: DEFAULT_PROVIDER,
                    integration_key: integrationKey,
                    data:
                        payload.mode || payload.credentials
                            ? {
                                  auth_scheme: payload.mode,
                                  credentials: payload.credentials,
                              }
                            : undefined,
                },
            }

            const result = await createConnection(request)
            invalidate()
            return result
        },
        [integrationKey, invalidate],
    )

    const handleDelete = useCallback(
        async (connectionId: string) => {
            await deleteToolConnection(connectionId)
            invalidate()
        },
        [invalidate],
    )

    const handleRefresh = useCallback(
        async (connectionId: string) => {
            const result = await refreshToolConnection(connectionId)
            invalidate()
            return result
        },
        [invalidate],
    )

    return {handleCreate, handleDelete, handleRefresh, invalidate}
}
