import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryToolConnections} from "../api"
import type {ToolConnection} from "../core/types"

const statusOf = (error: unknown) => (error as {statusCode?: unknown})?.statusCode

/**
 * The caller's own connections, in every project of the organization. Null when personal
 * accounts are off (the route answers 403), so "Yours" hides instead of failing.
 */
export const personalToolConnectionsQueryAtom = atomWithQuery<ToolConnection[] | null>((get) => {
    const projectId = get(projectIdAtom)
    return {
        // Under the shared ["tools", "connections"] key, so every connection write refreshes it.
        queryKey: ["tools", "connections", "user", projectId],
        queryFn: async () => {
            try {
                return (await queryToolConnections({owner: "user"})).connections ?? []
            } catch (error) {
                if (statusOf(error) === 403) return null
                throw error
            }
        },
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        enabled: !!projectId,
    }
})

export const usePersonalToolConnections = () => {
    const query = useAtomValue(personalToolConnectionsQueryAtom)
    return {
        connections: query.data ?? null,
        isLoading: query.isPending,
        error: query.error,
    }
}
