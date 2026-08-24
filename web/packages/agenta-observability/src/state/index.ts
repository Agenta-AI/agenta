import {projectIdAtom} from "@agenta/shared/state"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchDashboardAnalytics} from "../api/dashboard"
import {resolveRangePreset} from "../core/presets"
import type {AnalyticsRange, DashboardData} from "../core/types"

/** The window every usage surface shares — one picker anywhere moves them all, as before. */
export const observabilityRangeAtom = atom<AnalyticsRange>(resolveRangePreset("1 month"))

/**
 * Keyed by scope: `null` is the whole project (Home's usage strip), an id scopes to one
 * app/agent (the observability page). A family rather than a router-derived atom so packages
 * can mount it without knowing the host's routing.
 */
export const observabilityDashboardQueryAtomFamily = atomFamily((appId: string | null) =>
    atomWithQuery<DashboardData | null>((get) => {
        const projectId = get(projectIdAtom)
        const range = get(observabilityRangeAtom)

        return {
            queryKey: ["observability", "dashboard", appId ?? "__global__", projectId, range],
            queryFn: async ({signal}) => {
                if (!projectId) return null
                return fetchDashboardAnalytics({projectId, appId, range, signal})
            },
            enabled: Boolean(projectId),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
        }
    }),
)

export interface ObservabilityDashboardState {
    data: DashboardData | null
    loading: boolean
    isFetching: boolean
    error: unknown
    refetch: () => void
}

/** `appId` scopes the figures to one app/agent; omit it for the whole project. */
export const useObservabilityDashboard = (
    appId: string | null = null,
): ObservabilityDashboardState => {
    const query = useAtomValue(observabilityDashboardQueryAtomFamily(appId))

    const {data, isFetching, error, refetch, fetchStatus} = query

    const fetching = fetchStatus === "fetching"

    return {
        data: data ?? null,
        // Not `isPending`: a disabled query (no project yet) is pending forever, which pinned
        // every usage card to its skeleton. An idle fetch status is the settled state.
        loading: fetchStatus !== "idle",
        isFetching: Boolean(isFetching) || fetching,
        error,
        refetch,
    }
}
