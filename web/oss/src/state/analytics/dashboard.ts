import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import {atom, useAtom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {SortResult} from "@/oss/components/Filters/Sort"
import {fetchAgentAnalyticsDashboard} from "@/oss/services/tracing/api/agentAnalytics"
import type {AgentAnalyticsDashboard} from "@/oss/services/tracing/types/agentAnalytics"
import {projectIdAtom} from "@/oss/state/project"

dayjs.extend(utc)

// The Analytics page opens on the last 7 days.
export const analyticsTimeRangeAtom = atom<SortResult>({
    type: "standard",
    sorted: dayjs().utc().subtract(7, "days").toISOString().split(".")[0],
    customRange: {},
    label: "7 days",
})

// Selected agent (workflow) ids; empty means every agent in the project.
export const analyticsAgentsFilterAtom = atom<string[]>([])

export const analyticsDashboardQueryAtom = atomWithQuery<AgentAnalyticsDashboard | null>((get) => {
    const projectId = get(projectIdAtom)
    const timeRange = get(analyticsTimeRangeAtom)
    const agentIds = get(analyticsAgentsFilterAtom)

    return {
        queryKey: ["analytics", "dashboard", projectId ?? null, timeRange, agentIds],
        queryFn: async ({signal}) => {
            if (!projectId) return null
            return fetchAgentAnalyticsDashboard({projectId, range: timeRange, agentIds, signal})
        },
        enabled: Boolean(projectId),
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
    }
})

export const useAnalyticsDashboard = () => {
    const [query] = useAtom(analyticsDashboardQueryAtom)
    const {data, isPending, isFetching, isLoading, error, refetch, fetchStatus} = query as any

    const fetching = fetchStatus === "fetching"
    const loading = Boolean(fetching || isPending || isLoading)

    return {
        data: (data as AgentAnalyticsDashboard | null) ?? null,
        loading,
        isFetching: Boolean(isFetching) || fetching,
        error,
        refetch,
    }
}
