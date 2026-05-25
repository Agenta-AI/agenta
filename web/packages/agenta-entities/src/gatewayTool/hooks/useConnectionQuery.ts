import {useMemo} from "react"

import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchConnection} from "../api"
import type {ToolConnectionResponse} from "../core/types"

interface ConnectionQueryState {
    data?: ToolConnectionResponse
    isPending: boolean
    error: unknown
    refetch: () => Promise<unknown>
}

export const connectionQueryAtomFamily = atomFamily((connectionId: string) =>
    atomWithQuery<ToolConnectionResponse>(() => ({
        queryKey: ["tools", "connections", connectionId],
        queryFn: () => fetchConnection(connectionId),
        enabled: !!connectionId,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    })),
)

const emptyConnectionQueryAtom = atom<ConnectionQueryState>({
    data: undefined as ToolConnectionResponse | undefined,
    isPending: false,
    error: null,
    refetch: async () => ({}),
})

export const useConnectionQuery = (connectionId?: string) => {
    const queryAtom = useMemo(
        () => (connectionId ? connectionQueryAtomFamily(connectionId) : emptyConnectionQueryAtom),
        [connectionId],
    )
    const query = useAtomValue(queryAtom)

    return {
        connection: query.data?.connection ?? null,
        isLoading: !!connectionId && query.isPending,
        error: query.error,
        refetch: query.refetch,
    }
}
