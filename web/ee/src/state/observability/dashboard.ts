import {useAtom} from "jotai"
import {eagerAtom} from "jotai-eager"
import {atomWithQuery} from "jotai-tanstack-query"

import {GenerationDashboardData} from "@/oss/lib/types_ee"
import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project"
import {fetchGenerationsDashboardData} from "@/oss/services/tracing/api"

const DEFAULT_RANGE = "30_days"

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
                DEFAULT_RANGE,
            ],
            queryFn: async ({signal}) => {
                if (!projectId) return null
                return fetchGenerationsDashboardData(appId, {
                    range: DEFAULT_RANGE,
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
