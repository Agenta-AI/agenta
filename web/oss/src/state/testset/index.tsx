import {useCallback, useMemo} from "react"

import {useAtom, getDefaultStore} from "jotai"

import {previewTestsetsQueryAtom, testsetsQueryAtomFamily} from "./atoms/fetcher"
import {useTestset} from "./hooks/useTestset"

/**
 * Hook for regular/legacy testsets
 */
export const useTestsetsData = ({enabled = true}: {enabled?: boolean} = {}) => {
    const [
        {data: testsets, isPending, isLoading: queryLoading, isFetching, refetch, error, isError},
    ] = useAtom(testsetsQueryAtomFamily({enabled}))

    const safeTestsets = Array.isArray(testsets) ? testsets : []

    const columnsByTestsetId = useMemo(() => {
        const result: Record<string, string[] | undefined> = {}
        safeTestsets.forEach((ts: any) => {
            const id = ts?._id ?? ts?.id
            if (!id || typeof id !== "string") return

            const columns = Array.isArray(ts?.columns)
                ? (ts.columns as unknown[])
                      .map((column) => (typeof column === "string" ? column.trim() : ""))
                      .filter((column): column is string => column.length > 0)
                : undefined

            result[id] = columns && columns.length > 0 ? columns : undefined
        })
        return result
    }, [safeTestsets])

    const getColumnsFor = useCallback(
        (id?: string) => {
            if (!id) return []
            const value = columnsByTestsetId[id]
            return Array.isArray(value) ? value : []
        },
        [columnsByTestsetId],
    )

    return {
        testsets: safeTestsets,
        isError,
        error,
        isLoading: Boolean(isPending || queryLoading || isFetching),
        mutate: refetch,
        columnsByTestsetId,
        getColumnsFor,
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
