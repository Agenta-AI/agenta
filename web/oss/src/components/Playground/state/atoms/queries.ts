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
        const {variantId, prevRevisionId} = params
        const store = getDefaultStore()

        return new Promise((resolve) => {
            let unsubscribe: (() => void) | null = null

            const cleanup = () => {
                if (unsubscribe) unsubscribe()
            }

            const check = () => {
                const newest = store.get(newestRevisionForVariantIdAtomFamily(variantId)) as any
                const newestId = newest?.id || null
                if (!newestId) return
                if (!prevRevisionId || newestId !== prevRevisionId) {
                    cleanup()
                    resolve({newestRevisionId: newestId})
                }
            }

            unsubscribe = store.sub(newestRevisionForVariantIdAtomFamily(variantId), check)
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
