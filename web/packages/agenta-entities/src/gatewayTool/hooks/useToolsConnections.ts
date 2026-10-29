/**
 * Create / delete / refresh for one integration's connections, plus the invalidation the tools
 * surfaces share.
 *
 * It lives in the ENTITY layer rather than beside its first caller in @agenta/settings-ui because
 * the client-tool connect flow (@agenta/entity-ui `clientTools/useConnectFlow`) also runs it. A
 * @agenta/entity-ui → @agenta/settings-ui import would close a workspace package cycle
 * (settings-ui already depends on entity-ui), and such a cycle breaks the production build — see
 * `web/packages/agenta-shared/tests/unit/workspaceGraph.test.ts`. @agenta/settings-ui re-exports
 * this hook, so its own public API is unchanged.
 */
import {useCallback} from "react"

import {getHostQueryClient} from "@agenta/shared/api"

import {createToolConnection, deleteToolConnection, refreshToolConnection} from "../api"
import type {ToolConnectionCreatePayload} from "../core"

const DEFAULT_PROVIDER = "composio"

export interface CreateConnectionInput {
    slug: string
    name?: string
    description?: string
    mode?: "oauth" | "api_key"
}

export const useToolsConnections = (integrationKey: string) => {
    const invalidate = useCallback(() => {
        const queryClient = getHostQueryClient()
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
                    data: payload.mode ? {auth_scheme: payload.mode} : undefined,
                },
            }

            const result = await createToolConnection(request)
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
