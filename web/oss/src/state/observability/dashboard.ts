import dayjs from "dayjs"
import utc from "dayjs/plugin/utc"
import {atom, useAtom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {SortResult} from "@/oss/components/Filters/Sort"
import {GenerationDashboardData} from "@/oss/lib/types_ee"
import {fetchGenerationsDashboardData} from "@/oss/services/tracing/api"
import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project"

dayjs.extend(utc)

export const observabilityDashboardTimeRangeAtom = atom<SortResult>({
    type: "standard",
    sorted: dayjs().utc().subtract(30, "days").toISOString().split(".")[0],
    customRange: {},
    label: "1 month",
})

export const observabilityDashboardQueryAtom = atomWithQuery<GenerationDashboardData | null>(
    (get) => {
        const appId = get(routerAppIdAtom)
        const projectId = get(projectIdAtom)

        return {
            queryKey: [
                "observability",
                "dashboard",
                appId ?? "__global__",
                projectId ?? null,
                get(observabilityDashboardTimeRangeAtom),
            ],
            queryFn: async ({signal}) => {
                if (!projectId) return null
                const timeRange = get(observabilityDashboardTimeRangeAtom)
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

    const {data, isPending, isFetching, isLoading, error, refetch, fetchStatus} = query as any

    const fetching = fetchStatus === "fetching"
    const loading = Boolean(fetching || isPending || isLoading)

    return {
        data: (data as GenerationDashboardData | null) ?? null,
        loading,
        isFetching: Boolean(isFetching) || fetching,
        error,
        refetch,
    }
}
