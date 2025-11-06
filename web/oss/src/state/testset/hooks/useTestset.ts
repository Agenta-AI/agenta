import {useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {Testset, PreviewTestset} from "@/oss/lib/Types"
import {fetchTestset} from "@/oss/services/testsets/api"

import {projectIdAtom} from "../../project"

/**
 * Atom family for fetching individual testsets
 * Supports both regular and preview testsets with proper typing
 */
export const testsetQueryAtomFamily = atomFamily(
    ({testsetId, preview}: {testsetId: string; preview?: boolean}) =>
        atomWithQuery<Testset | PreviewTestset>((get) => {
            const projectId = get(projectIdAtom)

            return {
                queryKey: ["testset", testsetId, preview ? "preview" : "regular", projectId],
                queryFn: () => fetchTestset(testsetId, preview),
                staleTime: 1000 * 60 * 2, // 2 minutes
                refetchOnWindowFocus: false,
                refetchOnReconnect: false,
                refetchOnMount: true,
                enabled: !!testsetId && !!projectId,
                retry: (failureCount, error) => {
                    // Don't retry on client errors (404, etc.)
                    if (
                        (error as any)?.response?.status >= 400 &&
                        (error as any)?.response?.status < 500
                    ) {
                        return false
                    }
                    return failureCount < 2
                },
            }
        }),
)

/**
 * Hook for fetching a single testset using Jotai atoms
 * Replaces the SWR-based useTestset hook with the same interface
 *
 * @param testsetId - ID of the testset to fetch
 * @param preview - Whether to fetch preview version (optional)
 * @returns Query result with same interface as SWR hook
 */
export function useTestset<T extends boolean = false>(
    testsetId?: string,
    preview?: T,
): {
    data: T extends true ? PreviewTestset : Testset
    error: any
    isLoading: boolean
    isPending: boolean
    isError: boolean
    isSuccess: boolean
    refetch: () => void
    mutate: () => void
} {
    const queryAtom = testsetQueryAtomFamily({
        testsetId: testsetId || "",
        preview: preview || false,
    })

    const queryResult = useAtomValue(queryAtom)

    return {
        data: queryResult.data as T extends true ? PreviewTestset : Testset,
        error: queryResult.error,
        isLoading: queryResult.isPending,
        isPending: queryResult.isPending,
        isError: queryResult.isError,
        isSuccess: queryResult.isSuccess,
        refetch: queryResult.refetch,
        mutate: queryResult.refetch, // For SWR compatibility
    }
}
