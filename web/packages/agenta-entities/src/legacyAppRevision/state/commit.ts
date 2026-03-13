/**
 * Legacy Revision Polling Utilities
 *
 * Provides utilities for polling revision lists to detect new revisions.
 * Used by createVariant flow which needs to wait for new revisions to appear.
 */

import {atom, getDefaultStore} from "jotai"
import {atomFamily} from "jotai-family"

import {revisionsListAtomFamily} from "./store"

// ============================================================================
// POLLING UTILITIES
// ============================================================================

/**
 * Selector for newest revision in a variant's revision list
 */
export const newestRevisionForVariantAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const revisions = get(revisionsListAtomFamily(variantId))
        if (!revisions || revisions.length === 0) return null

        return revisions.reduce((newest, current) => {
            const newestRev = newest?.revision ?? 0
            const currentRev = current?.revision ?? 0
            return currentRev > newestRev ? current : newest
        }, revisions[0])
    }),
)

/**
 * Wait for a new revision to appear in the revision list.
 *
 * This is the core workaround for the API not returning new revision IDs.
 * Polls the revision list until a revision different from prevRevisionId appears.
 */
export async function waitForNewRevision(params: {
    variantId: string
    prevRevisionId: string | null
    timeoutMs?: number
    pollIntervalMs?: number
}): Promise<{newestRevisionId: string | null; newestRevision: number | null}> {
    const {variantId, prevRevisionId, timeoutMs = 15_000, pollIntervalMs = 250} = params
    const store = getDefaultStore()

    if (!variantId) {
        return {newestRevisionId: null, newestRevision: null}
    }

    return new Promise((resolve) => {
        let intervalId: ReturnType<typeof setInterval> | null = null
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        const cleanup = () => {
            if (intervalId) clearInterval(intervalId)
            if (timeoutId) clearTimeout(timeoutId)
        }

        const check = () => {
            const newest = store.get(newestRevisionForVariantAtomFamily(variantId))
            const newestId = newest?.id ?? null
            const newestRev = newest?.revision ?? null

            if (!newestId) return

            // If we have a new revision (different from previous), resolve
            if (!prevRevisionId || newestId !== prevRevisionId) {
                cleanup()
                resolve({newestRevisionId: newestId, newestRevision: newestRev})
            }
        }

        // Set up polling
        intervalId = setInterval(check, pollIntervalMs)

        // Set up timeout (best-effort: return whatever is newest)
        timeoutId = setTimeout(() => {
            cleanup()
            const newest = store.get(newestRevisionForVariantAtomFamily(variantId))
            resolve({
                newestRevisionId: newest?.id ?? null,
                newestRevision: newest?.revision ?? null,
            })
        }, timeoutMs)

        // Check immediately in case it's already updated
        check()
    })
}
