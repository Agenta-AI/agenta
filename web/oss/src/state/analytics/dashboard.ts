import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import {atom, useAtom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {SortResult} from "@/oss/components/Filters/Sort"
import {
    type AgentAnalyticsFilterOptions,
    fetchAgentAnalyticsDashboard,
    fetchAgentAnalyticsFilterOptions,
} from "@/oss/services/tracing/api/agentAnalytics"
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
// Selected harness kinds; empty means every harness.
export const analyticsHarnessFilterAtom = atom<string[]>([])
// Selected configured-model aliases; empty means every model.
export const analyticsModelsFilterAtom = atom<string[]>([])

export const analyticsDashboardQueryAtom = atomWithQuery<AgentAnalyticsDashboard | null>((get) => {
    const projectId = get(projectIdAtom)
    const timeRange = get(analyticsTimeRangeAtom)
    const agentIds = get(analyticsAgentsFilterAtom)
    const harnessKinds = get(analyticsHarnessFilterAtom)
    const models = get(analyticsModelsFilterAtom)

    return {
        queryKey: [
            "analytics",
            "dashboard",
            projectId ?? null,
            timeRange,
            agentIds,
            harnessKinds,
            models,
        ],
        queryFn: async ({signal}) => {
            if (!projectId) return null
            return fetchAgentAnalyticsDashboard({
                projectId,
                range: timeRange,
                agentIds,
                harnessKinds,
                models,
                signal,
            })
        },
        enabled: Boolean(projectId),
        staleTime: 1000 * 60,
        refetchOnWindowFocus: false,
    }
})

// Filter dropdown options: a breakdown scoped by project/window/agent but NOT by the
// harness/model filters, so selecting one value never removes the others.
export const analyticsFilterOptionsQueryAtom = atomWithQuery<AgentAnalyticsFilterOptions | null>(
    (get) => {
        const projectId = get(projectIdAtom)
        const timeRange = get(analyticsTimeRangeAtom)
        const agentIds = get(analyticsAgentsFilterAtom)

        return {
            queryKey: ["analytics", "filter-options", projectId ?? null, timeRange, agentIds],
            queryFn: async ({signal}) => {
                if (!projectId) return null
                return fetchAgentAnalyticsFilterOptions({
                    projectId,
                    range: timeRange,
                    agentIds,
                    signal,
                })
            },
            enabled: Boolean(projectId),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
        }
    },
)

export const useAnalyticsFilterOptions = () => {
    const [query] = useAtom(analyticsFilterOptionsQueryAtom)
    const {data} = query as any
    return (data as AgentAnalyticsFilterOptions | null) ?? null
}

export const useAnalyticsDashboard = () => {
    const [query] = useAtom(analyticsDashboardQueryAtom)
    const {data, isPending, isFetching, isLoading, isError, error, refetch, fetchStatus} =
        query as any

    const fetching = fetchStatus === "fetching"
    const loading = Boolean(fetching || isPending || isLoading)

    return {
        data: (data as AgentAnalyticsDashboard | null) ?? null,
        loading,
        isFetching: Boolean(isFetching) || fetching,
        isError: Boolean(isError),
        error,
        refetch,
    }
}
