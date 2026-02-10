/**
 * Query helpers and revision-tracking selectors
 * Scope: query invalidation and waiting for new revisions.
 */
import {revisionCacheVersionAtom} from "@agenta/entities/legacyAppRevision"
import isEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {queryClient} from "@/oss/lib/api/queryClient"

import {playgroundRevisionListAtom} from "./variants"

export const variantRevisionsForVariantIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        atom((get) => get(playgroundRevisionListAtom) || []),
        (revisions) => (variantId ? revisions.filter((r: any) => r.variantId === variantId) : []),
        isEqual,
    ),
)

export const newestRevisionForVariantIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        variantRevisionsForVariantIdAtomFamily(variantId),
        (list: any[]) => {
            if (!list || list.length === 0) return null
            return list.reduce((newest, current) => {
                const newestRev = Number(newest?.revision) || 0
                const currentRev = Number(current?.revision) || 0
                return currentRev > newestRev ? current : newest
            }, list[0])
        },
        isEqual,
    ),
)

/**
 * Writable atom that resolves when a newer revision than prevRevisionId appears for variantId
 */
export const waitForNewRevisionAfterMutationAtom = atom(
    null,
    async (
        get,
        _set,
        params: {variantId: string; prevRevisionId?: string | null; timeoutMs?: number},
    ): Promise<{newestRevisionId: string | null}> => {
        const {variantId, prevRevisionId, timeoutMs = 15_000} = params
        const store = getDefaultStore()

        // If we don't have a variantId to watch, don't hang forever.
        if (!variantId) {
            return {newestRevisionId: null}
        }

        return new Promise((resolve) => {
            let unsubscribe: (() => void) | null = null
            let intervalId: ReturnType<typeof setInterval> | null = null
            let timeoutId: ReturnType<typeof setTimeout> | null = null

            const check = () => {
                const newest = store.get(newestRevisionForVariantIdAtomFamily(variantId)) as any
                const newestId = newest?.id || null

                if (!newestId) return
                if (!prevRevisionId || newestId !== prevRevisionId) {
                    if (unsubscribe) unsubscribe()
                    if (intervalId) clearInterval(intervalId)
                    if (timeoutId) clearTimeout(timeoutId)
                    resolve({newestRevisionId: newestId})
                }
            }

            // Prefer subscription when available, but also poll as a safety net.
            try {
                if ((store as any).sub) {
                    unsubscribe = (store as any).sub(
                        newestRevisionForVariantIdAtomFamily(variantId),
                        check,
                    )
                }
            } catch {
                // ignore; we'll rely on polling + timeout
            }

            intervalId = setInterval(check, 250)
            timeoutId = setTimeout(() => {
                if (unsubscribe) unsubscribe()
                if (intervalId) clearInterval(intervalId)
                // Best-effort: return whatever is currently newest (may still be prevRevisionId)
                const newest = store.get(newestRevisionForVariantIdAtomFamily(variantId)) as any
                const newestId = newest?.id || null
                resolve({newestRevisionId: newestId})
            }, timeoutMs)

            // Run once in case it's already updated
            check()
        })
    },
)

/**
 * Writable atom that resolves when a revision is removed from the list
 */
export const waitForRevisionRemovalAtom = atom(
    null,
    async (
        get,
        _set,
        params: {revisionId: string; variantId: string; timeoutMs?: number},
    ): Promise<{removed: boolean; newSelectedId: string | null}> => {
        const {revisionId, variantId, timeoutMs = 15_000} = params
        const store = getDefaultStore()

        return new Promise((resolve) => {
            let intervalId: ReturnType<typeof setInterval> | null = null
            let timeoutId: ReturnType<typeof setTimeout> | null = null

            const check = () => {
                const list = (store.get(playgroundRevisionListAtom) || []) as any[]
                const exists = list.some((r: any) => r?.id === revisionId)

                // If the revision no longer exists in the list, it's been removed
                // We don't require the list count to decrease since the list may have
                // been repopulated with different items during the refetch
                if (!exists) {
                    if (intervalId) clearInterval(intervalId)
                    if (timeoutId) clearTimeout(timeoutId)

                    // Compute preferred next selection
                    const allSorted = list.slice().sort((a: any, b: any) => {
                        const at = a?.updatedAtTimestamp ?? a?.createdAtTimestamp ?? 0
                        const bt = b?.updatedAtTimestamp ?? b?.createdAtTimestamp ?? 0
                        return bt - at
                    })
                    const sameVariantSorted = allSorted.filter(
                        (r: any) => r?.variantId === variantId,
                    )
                    const preferred = sameVariantSorted[0]?.id || allSorted[0]?.id || null

                    resolve({removed: true, newSelectedId: preferred})
                }
            }

            intervalId = setInterval(check, 200)
            timeoutId = setTimeout(() => {
                if (intervalId) clearInterval(intervalId)
                // Timeout - check final state
                const list = (store.get(playgroundRevisionListAtom) || []) as any[]
                const exists = list.some((r: any) => r?.id === revisionId)
                resolve({removed: !exists, newSelectedId: null})
            }, timeoutMs)

            // Run once immediately
            check()
        })
    },
)

/**
 * Consolidated query invalidation atom
 * Invalidates queries and forces fresh refetch with cache busting
 *
 * Note: Query keys are prefixes - invalidating ["variants"] will match
 * ["variants", appId, projectId] etc.
 */
export const invalidatePlaygroundQueriesAtom = atom(null, async (_get, set) => {
    // First invalidate to mark as stale
    // Use exact: false (default) to match all queries starting with these prefixes
    await Promise.all([
        // Legacy OSS query keys
        queryClient.invalidateQueries({queryKey: ["variants"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["variantRevisions"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["appVariants"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["appVariantRevisions"], exact: false}),
        // Entity package query keys (used by playgroundRevisionListAtom)
        queryClient.invalidateQueries({queryKey: ["oss-variants-for-selection"], exact: false}),
        queryClient.invalidateQueries({queryKey: ["oss-revisions-for-selection"], exact: false}),
    ])

    // Then refetch with type: 'all' to bypass cache
    // This ensures both active and inactive queries are refetched
    await Promise.all([
        queryClient.refetchQueries({
            queryKey: ["variants"],
            type: "all",
            exact: false,
        }),
        queryClient.refetchQueries({
            queryKey: ["variantRevisions"],
            type: "all",
            exact: false,
        }),
        queryClient.refetchQueries({
            queryKey: ["appVariants"],
            type: "all",
            exact: false,
        }),
        queryClient.refetchQueries({
            queryKey: ["appVariantRevisions"],
            type: "all",
            exact: false,
        }),
        // Entity package query keys
        queryClient.refetchQueries({
            queryKey: ["oss-variants-for-selection"],
            type: "all",
            exact: false,
        }),
        queryClient.refetchQueries({
            queryKey: ["oss-revisions-for-selection"],
            type: "all",
            exact: false,
        }),
    ])

    // Bump the revision cache version so that revisionListItemFromCacheAtomFamily
    // re-evaluates with the freshly-refetched data in React Query cache.
    set(revisionCacheVersionAtom, (prev) => prev + 1)
})
