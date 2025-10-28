import {useAtom} from "jotai"

import {PreviewTestsetsQueryPayload} from "@/oss/services/testsets/api/types"

import {
    previewTestsetsQueryAtom,
    previewTestsetsQueryAtomFamily,
    testsetsQueryAtom,
} from "../atoms/fetcher"

export {useTestset, testsetQueryAtomFamily} from "./useTestset"

/**
 * Hook for regular/legacy testsets.
 *
 * @param options.enabled - Whether the query is enabled (default: true)
 * @returns Object with `testsets`, `isError`, `error`, `isLoading`, `mutate`
 */
export const useTestsetsData = ({enabled = true} = {}) => {
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(testsetsQueryAtom)

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending,
        mutate: refetch,
    }
}

/**
 * Hook for preview testsets (no filters).
 *
 * @returns Object with `testsets`, `isError`, `error`, `isLoading`, `mutate`
 */
export const usePreviewTestsetsData = () => {
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(previewTestsetsQueryAtom)

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending,
        mutate: refetch,
    }
}

/**
 * Hook for preview testsets with filters.
 *
 * Use `useMemo` to pass a stable `payload` object so the query key remains stable.
 *
 * @param payload - Filter payload matching PreviewTestsetsQueryPayload
 * @param options.enabled - Whether the query is enabled (default: true)
 * @returns Object with `testsets`, `isError`, `error`, `isLoading`, `mutate`
 */
export const usePreviewTestsetsDataWithFilters = (
    payload: PreviewTestsetsQueryPayload = {},
    {enabled = true}: {enabled?: boolean} = {},
) => {
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(
        previewTestsetsQueryAtomFamily({payload, enabled}),
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
 * Combined hook that supports both regular and preview testsets.
 *
 * @param preview - If true, returns preview testsets; otherwise regular testsets
 * @returns Same shape as the underlying hook
 */
export const useTestsetsDataWithPreview = (preview = false) => {
    const regularData = useTestsetsData()
    const previewData = usePreviewTestsetsData()

    return preview ? previewData : regularData
}
