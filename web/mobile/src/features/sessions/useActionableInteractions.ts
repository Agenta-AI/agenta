import {queryInteractions, type SessionInteraction} from "@agenta/entities/session"
import {useQuery} from "@tanstack/react-query"

import {useLivenessPoll} from "./useLivenessPoll"

export const actionableInteractionsQueryKey = (projectId: string) =>
    ["mobile", "actionable-interactions", projectId] as const

/** Poll pending project HITL requests while a gate exists or a turn can create one. */
export const useActionableInteractions = (projectId: string) => {
    const liveness = useLivenessPoll(projectId)
    return useQuery<SessionInteraction[] | null>({
        queryKey: actionableInteractionsQueryKey(projectId),
        queryFn: ({signal}) =>
            queryInteractions({projectId, actionableOnly: true, abortSignal: signal}),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => {
            if ((query.state.data?.length ?? 0) > 0) return 15_000
            // Only running turns can mint new gates.
            return (liveness.data ?? []).some((stream) => stream.flags?.is_running) ? 15_000 : false
        },
        refetchOnWindowFocus: true,
    })
}

/** `session_id → pending count` off the poll result; `undefined` while it hasn't resolved. */
export const pendingCountBySession = (
    interactions: SessionInteraction[] | null | undefined,
): Map<string, number> | undefined => {
    if (interactions === undefined || interactions === null) return undefined
    const map = new Map<string, number>()
    for (const interaction of interactions) {
        map.set(interaction.session_id, (map.get(interaction.session_id) ?? 0) + 1)
    }
    return map
}
