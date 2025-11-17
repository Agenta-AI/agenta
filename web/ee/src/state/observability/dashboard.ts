import {atom, useAtom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import type {TimeRange} from "@/oss/components/TimeFilter"
import {GenerationDashboardData} from "@/oss/lib/types_ee"
import {fetchGenerationsDashboardData} from "@/oss/services/tracing/api"
import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project"

const DEFAULT_RANGE: TimeRange = "30_days"

export const observabilityDashboardTimeRangeAtom = atom<TimeRange>(DEFAULT_RANGE)

export const observabilityDashboardQueryAtom = atomWithQuery<GenerationDashboardData | null>(
    (get) => {
        const appId = get(routerAppIdAtom)
        const projectId = get(projectIdAtom)
        const timeRange = get(observabilityDashboardTimeRangeAtom)

        return {
            queryKey: [
                "observability",
                "dashboard",
                appId ?? "__global__",
                projectId ?? null,
                timeRange,
            ],
            queryFn: async ({signal}) => {
                if (!projectId) return null
                return fetchGenerationsDashboardData(appId, {
                    range: timeRange,
                    projectId,
                    signal,
                })
            },
            enabled: Boolean(projectId),
            staleTime: 1000 * 60,
            refetchOnWindowFocus: false,
        }
    },
)

export const observabilityDashboardAtom = eagerAtom<GenerationDashboardData | null>((get) => {
    const result = (get(observabilityDashboardQueryAtom) as any)
        ?.data as GenerationDashboardData | null
    return result ?? null
})

export const useObservabilityDashboard = () => {
    const [query] = useAtom(observabilityDashboardQueryAtom)
    const [timeRange, setTimeRange] = useAtom(observabilityDashboardTimeRangeAtom)

    const {data, isPending, isFetching, isLoading, error, refetch, fetchStatus} = query as any

    const fetching = fetchStatus === "fetching"
    const loading = Boolean(fetching || isPending || isLoading)

    return {
        data: (data as GenerationDashboardData | null) ?? null,
        loading,
        isFetching: Boolean(isFetching) || fetching,
        error,
        refetch,
        timeRange,
        setTimeRange,
    }
}
