import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {uriQueryAtomFamily} from "../atoms/fetcher"

/**
 * Hook for fetching app container URIs using Jotai atoms
 * Replaces the SWR-based useURI hook
 */
export const useURI = (appId: string, variantId?: string) => {
    const uriAtom = useMemo(() => uriQueryAtomFamily({appId, variantId}), [appId, variantId])

    const queryResult = useAtomValue(uriAtom)

    // Return the same interface as the original SWR hook for compatibility
    return {
        data: queryResult.data,
        error: queryResult.error,
        isLoading: queryResult.isPending,
        isValidating: queryResult.isPending,
        mutate: queryResult.refetch,
    }
}
