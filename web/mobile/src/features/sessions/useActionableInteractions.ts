import {
    queryInteractions,
    type SessionInteraction,
    type SessionStream,
} from "@agenta/entities/session"
import {useQuery, useQueryClient} from "@tanstack/react-query"

import {livenessQueryKey} from "./useLivenessPoll"

export const actionableInteractionsQueryKey = (projectId: string) =>
    ["mobile", "actionable-interactions", projectId] as const

/**
 * Every pending HITL request across the project in ONE query (`session_id` omitted,
 * `actionable_only: true`) — the list-badge primitive. Same cadence rules as the liveness poll:
 * 15s while anything is pending OR RUNNING (a running turn is what mints new gates), stops when
 * idle, re-checks on focus.
 */
export const useActionableInteractions = (projectId: string) => {
    const queryClient = useQueryClient()
    return useQuery<SessionInteraction[] | null>({
        queryKey: actionableInteractionsQueryKey(projectId),
        queryFn: ({signal}) =>
            queryInteractions({projectId, actionableOnly: true, abortSignal: signal}),
        enabled: Boolean(projectId),
        staleTime: 10_000,
        refetchInterval: (query) => {
            if ((query.state.data?.length ?? 0) > 0) return 15_000
            const alive = queryClient.getQueryData<SessionStream[] | null>(
                livenessQueryKey(projectId),
            )
            // RUNNING, not merely alive: a running turn is what mints new gates, and a stopped
            // or finished session keeps `is_alive` set so it can resume warm.
            return (alive ?? []).some((stream) => stream.flags?.is_running) ? 15_000 : false
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
