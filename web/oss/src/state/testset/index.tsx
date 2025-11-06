import {useEffect, useMemo, useRef, useState} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {useAtom, getDefaultStore} from "jotai"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {Testset} from "@/oss/lib/Types"

import {previewTestsetsQueryAtom, testsetsQueryAtomFamily} from "./atoms/fetcher"
import {useTestset} from "./hooks/useTestset"

/**
 * Hook for regular/legacy testsets
 */
export const useTestsetsData = ({enabled = true} = {}) => {
    const [{data: testsets, isPending, isLoading, refetch, error, isError}] = useAtom(
        testsetsQueryAtomFamily({enabled}),
    )
    const queryClient = useQueryClient()
    const [columnsFallback, setColumnsFallback] = useState<Record<string, string[]>>({})
    const [csvVersion, setCsvVersion] = useState(0)
    const [isValidating, setIsValidating] = useState(false)

    // Keep a ref in sync so the effect can read the latest fallback columns without re-running.
    const columnsFallbackRef = useRef(columnsFallback)
    useEffect(() => {
        columnsFallbackRef.current = columnsFallback
    }, [columnsFallback])

    // Track ids that we already attempted (success or non-cancel failure) and those in flight.
    const triedRef = useRef<Set<string>>(new Set())
    const inFlightRef = useRef<Set<string>>(new Set())

    // Extract CSV columns from the TanStack Query cache for any testset
    const cachedColumnsByTestsetId = useMemo(() => {
        if (!enabled) return {}
        const result: Record<string, string[] | undefined> = {}
        ;(testsets ?? []).forEach((ts: any) => {
            const csv = queryClient.getQueryData<Testset["csvdata"]>(["testsetCsvData", ts?._id])
            if (csv && Array.isArray(csv) && csv.length > 0) {
                const firstRow = (csv as any[])[0] || {}
                const source =
                    firstRow &&
                    typeof firstRow === "object" &&
                    (firstRow as any).data &&
                    typeof (firstRow as any).data === "object"
                        ? ((firstRow as any).data as Record<string, unknown>)
                        : (firstRow as Record<string, unknown>)
                result[ts._id] = Object.keys(source)
            } else {
                result[ts._id] = undefined
            }
        })
        return result
    }, [queryClient, testsets, csvVersion, enabled])

    // Merge cache with fallback (from preview single testcase query)
    // Depend on `columnsFallback` so consumers re-render when we infer columns.
    const columnsByTestsetId = useMemo(() => {
        if (!enabled) return {}
        const merged: Record<string, string[] | undefined> = {...cachedColumnsByTestsetId}
        Object.entries(columnsFallback).forEach(([id, cols]) => {
            if (!merged[id] || (merged[id]?.length ?? 0) === 0) {
                merged[id] = cols
            }
        })
        return merged
    }, [cachedColumnsByTestsetId, enabled, columnsFallback])

    // Background fill: for testsets without cached columns, fetch a single testcase to infer columns.
    useEffect(() => {
        if (!enabled) return
        if (isPending || isLoading) return

        const controller = new AbortController()

        const getPending = () => {
            const fallback = columnsFallbackRef.current
            const pending = (testsets ?? []).filter((ts: any) => {
                const id = ts?._id
                if (!id) return false
                // If cache already has columns, skip
                if (cachedColumnsByTestsetId[id]?.length) return false
                // If fallback already has columns, skip
                if (fallback[id]?.length) return false
                // Avoid double-starting work
                if (inFlightRef.current.has(id)) return false
                // Skip ids we already tried (success or hard failure)
                if (triedRef.current.has(id)) return false
                return true
            })
            return pending
        }

        const BATCH = 6
        let stopped = false

        const run = async () => {
            // Process as many batches as needed in one effect run to avoid re-run storms.
            setIsValidating(true)
            try {
                while (!stopped && !controller.signal.aborted) {
                    const pending = getPending()
                    if (pending.length === 0) break

                    const toFetch = pending.slice(0, BATCH)

                    await Promise.all(
                        toFetch.map(async (ts: any) => {
                            const id = ts._id
                            if (!id) return

                            // Mark as in-flight before firing the request
                            inFlightRef.current.add(id)
                            try {
                                const url = `${getAgentaApiUrl()}/preview/testcases/query`
                                const {data} = await axios.post(
                                    url,
                                    {
                                        testset_id: id,
                                        windowing: {limit: 1},
                                    },
                                    {signal: controller.signal},
                                )

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
                                    setColumnsFallback((prev) => {
                                        const next = {...prev, [id]: cols}
                                        // Keep ref in sync immediately for this loop
                                        columnsFallbackRef.current = next
                                        return next
                                    })
                                }
                                // Mark as tried after a completed call (success or empty)
                                triedRef.current.add(id)
                            } catch (e: any) {
                                // If aborted or axios-cancelled, allow retry in a future pass
                                const isCancelled =
                                    e?.name === "CanceledError" ||
                                    e?.name === "AbortError" ||
                                    e?.code === "ERR_CANCELED" ||
                                    (typeof (axios as any).isCancel === "function" &&
                                        (axios as any).isCancel(e))
                                if (!isCancelled) {
                                    // Hard failure: mark as tried to avoid hot loops
                                    triedRef.current.add(id)
                                }
                            } finally {
                                inFlightRef.current.delete(id)
                            }
                        }),
                    )

                    // Yield between batches so React can paint and we do not hog the tab
                    await new Promise((r) => setTimeout(r, 0))
                }
            } finally {
                setIsValidating(false)
            }
        }

        run()
        return () => {
            stopped = true
            controller.abort()
        }
        // Re-run only when inputs truly change (not on fallback writes)
    }, [enabled, isPending, isLoading, testsets, cachedColumnsByTestsetId])

    // Scoped csvVersion bumps: only bump for testset ids we care about
    useEffect(() => {
        if (!enabled) return
        const ids = new Set((testsets ?? []).map((t: any) => t?._id).filter(Boolean))

        const unsubscribe = queryClient.getQueryCache().subscribe((event: any) => {
            if (event?.type !== "updated") return
            const q = event?.query
            if (q?.queryKey?.[0] !== "testsetCsvData") return
            const id = q?.queryKey?.[1]
            if (!ids.has(id)) return
            setCsvVersion((v) => v + 1)
        })
        return unsubscribe
    }, [enabled, queryClient, testsets])

    return {
        testsets: testsets ?? [],
        isError,
        error,
        isLoading: isPending || isLoading || isValidating,
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
