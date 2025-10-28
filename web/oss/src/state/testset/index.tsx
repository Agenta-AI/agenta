import {useEffect, useMemo, useRef, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, getDefaultStore} from "jotai"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {TestSet} from "@/oss/lib/Types"

import {previewTestsetsQueryAtom, testsetsQueryAtom} from "./atoms/fetcher"
import {useTestset} from "./hooks/useTestset"

/**
 * Hook for regular/legacy testsets
 */
export const useTestsetsData = ({enabled = true} = {}) => {
    const [{data: testsets, isPending, refetch, error, isError}] = useAtom(testsetsQueryAtom)
    const queryClient = useQueryClient()
    const [columnsFallback, setColumnsFallback] = useState<Record<string, string[]>>({})
    const [csvVersion, setCsvVersion] = useState(0)

    // Extract CSV columns from the TanStack Query cache for any testset
    const cachedColumnsByTestsetId = useMemo(() => {
        const result: Record<string, string[] | undefined> = {}
        ;(testsets ?? []).forEach((ts: any) => {
            const csv = queryClient.getQueryData<TestSet["csvdata"]>(["testsetCsvData", ts?._id])
            if (csv && Array.isArray(csv) && csv.length > 0) {
                const firstRow = (csv as any[])[0] || {}
                const source =
                    firstRow &&
                    typeof firstRow === "object" &&
                    firstRow.data &&
                    typeof firstRow.data === "object"
                        ? (firstRow.data as Record<string, unknown>)
                        : (firstRow as Record<string, unknown>)
                result[ts._id] = Object.keys(source)
            } else {
                result[ts._id] = undefined
            }
        })
        return result
    }, [queryClient, testsets, csvVersion])

    // Merge cache with fallback (from preview single testcase query)
    const columnsByTestsetId = useMemo(() => {
        const merged: Record<string, string[] | undefined> = {...cachedColumnsByTestsetId}
        Object.entries(columnsFallback).forEach(([id, cols]) => {
            if (!merged[id] || (merged[id]?.length ?? 0) === 0) {
                merged[id] = cols
            }
        })
        return merged
    }, [cachedColumnsByTestsetId, columnsFallback])

    // Background fill: for testsets without cached columns, fetch a single testcase to infer columns
    const triedRef = useRef<Set<string>>(new Set())
    useEffect(() => {
        const controller = new AbortController()
        const tried = triedRef.current
        const run = async () => {
            if (!Array.isArray(testsets) || testsets.length === 0) return
            const pending = testsets.filter((ts: any) => {
                const id = ts?._id
                if (!id) return false
                if (columnsByTestsetId[id]) return false
                if (columnsFallback[id]) return false
                if (tried.has(id)) return false
                return true
            })
            if (pending.length === 0) return
            // Limit concurrent fetches
            const BATCH = 6
            const toFetch = pending.slice(0, BATCH)
            await Promise.all(
                toFetch.map(async (ts: any) => {
                    try {
                        const url = `${getAgentaApiUrl()}/preview/testcases/query`
                        const {data} = await axios.post(
                            url,
                            {
                                testset_id: ts._id,
                                windowing: {limit: 1},
                            },
                            {signal: controller.signal},
                        )
                        // Response shape:
                        // { count: number, testcases: [{ data: { ...columns }, ... }] }
                        const rows: any[] = Array.isArray(data?.testcases)
                            ? data.testcases
                            : Array.isArray(data)
                              ? data
                              : []
                        const first = rows[0]
                        const dataObj =
                            first?.data && typeof first.data === "object" ? first.data : {}
                        const cols = Object.keys(dataObj as Record<string, unknown>)
                        if (cols.length) {
                            setColumnsFallback((prev) => ({...prev, [ts._id]: cols}))
                            // Also hydrate the primary cache so all consumers see columns immediately
                            queryClient.setQueryData(["testsetCsvData", ts._id], [dataObj])
                        } else {
                            tried.add(ts._id)
                        }
                    } catch (e) {
                        // swallow; keep fallback empty for this id
                        tried.add(ts._id)
                        // console.warn("Failed to infer columns for testset", ts?._id, e)
                    }
                }),
            )
        }
        run()
        return () => controller.abort()
    }, [testsets, columnsByTestsetId, columnsFallback])

    // When any testsetCsvData query updates, bump csvVersion
    useEffect(() => {
        const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
            // Only react to updates of our csv data queries
            const q = (event as any)?.query
            const key0 = q?.queryKey?.[0]
            if (key0 === "testsetCsvData") {
                setCsvVersion((v) => v + 1)
            }
        })
        return unsubscribe
    }, [queryClient])

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending,
        mutate: refetch,
        // New helpers (non-breaking):
        columnsByTestsetId,
        getColumnsFor: (id?: string) => (id ? (columnsByTestsetId[id] ?? []) : []),
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
