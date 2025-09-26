import {useMemo} from "react"

import {useAtom, getDefaultStore} from "jotai"

import {previewTestsetsQueryAtom, testsetsQueryAtomFamily} from "./atoms/fetcher"
import {useTestset} from "./hooks/useTestset"

/**
 * Hook for regular/legacy testsets
 */
export const useTestsetsData = ({enabled = true} = {}) => {
    const stableAtom = useMemo(() => testsetsQueryAtomFamily({enabled}), [enabled])
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(stableAtom)

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending,
        mutate: refetch,
    }
}

/**
 * Hook for preview testsets
 */
export const usePreviewTestsetsData = () => {
    const store = getDefaultStore()
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(
        previewTestsetsQueryAtom,
        {store},
    )

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending,
        mutate: refetch,
    }
}

/**
 * Combined hook that supports both regular and preview testsets
 * @param preview - Whether to fetch preview testsets (default: false)
 */
export const useTestsetsDataWithPreview = (preview = false) => {
    const regularData = useTestsetsData()
    const previewData = usePreviewTestsetsData()

    return preview ? previewData : regularData
}

// Export the single testset hook
export {useTestset}
