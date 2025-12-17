/**
 * Query helpers and revision-tracking selectors
 * Scope: query invalidation and waiting for new revisions.
 */
import isEqual from "fast-deep-equal"
import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

import {queryClient} from "@/oss/lib/api/queryClient"

import {revisionListAtom} from "./variants"

export const variantRevisionsForVariantIdAtomFamily = atomFamily((variantId: string) =>
    selectAtom(
        atom((get) => get(revisionListAtom) || []),
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
 * Consolidated query invalidation atom
 */
export const invalidatePlaygroundQueriesAtom = atom(null, async () => {
    await Promise.all([
        queryClient.invalidateQueries({queryKey: ["variants"]}),
        queryClient.invalidateQueries({queryKey: ["variantRevisions"]}),
        queryClient.invalidateQueries({queryKey: ["appVariants"]}),
    ])
})
