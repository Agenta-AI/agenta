import {useCallback, useMemo} from "react"

import {useAtom, useAtomValue} from "jotai"

import {useEntityList} from "@/oss/state/entities/hooks/useEntityList"
import {testsetStore} from "@/oss/state/entities/testset/store"
import {projectIdAtom} from "@/oss/state/project"

import {previewTestsetsQueryAtom} from "../atoms/fetcher"

/**
 * Hook for regular testsets - uses entity-based testset store
 *
 * @param options.enabled - Whether the query is enabled (default: true)
 * @returns Object with `testsets`, `isError`, `error`, `isLoading`, `mutate`, `columnsByTestsetId`, `getColumnsFor`
 */
export const useTestsetsData = ({enabled = true}: {enabled?: boolean} = {}) => {
    const projectId = useAtomValue(projectIdAtom)

    // Memoize params to prevent infinite re-renders from new object references
    const listParams = useMemo(() => ({projectId: projectId ?? ""}), [projectId])

    const {
        data: testsetListResponse,
        isLoading,
        isFetching,
        isError,
        error,
        refetch,
    } = useEntityList(testsetStore, listParams, {
        extractEntities: (response) => response?.testsets ?? [],
    })

    const safeTestsets = useMemo(() => testsetListResponse?.testsets ?? [], [testsetListResponse])

    const columnsByTestsetId = useMemo(() => {
        const result: Record<string, string[] | undefined> = {}
        safeTestsets.forEach((ts: any) => {
            const id = ts?.id
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
        isLoading: Boolean(isLoading || isFetching),
        mutate: refetch,
        columnsByTestsetId,
        getColumnsFor,
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
