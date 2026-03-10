/**
 * Response Store — playground-specific, no entity equivalent.
 *
 * Extracted to its own file so that consumers (e.g. hash.ts used by the web
 * worker) can import it without pulling in the @agenta/entities barrel which
 * transitively loads axios and references `window`.
 */

import {atom, getDefaultStore} from "jotai"

import {TestResult} from "@/oss/lib/shared/variant/types"

// Create an atom store
export const atomStore = getDefaultStore()

// Atom to store responses
export const responseAtom = atom<Record<string, TestResult>>({})
export const getResponseLazy = <T extends TestResult>(
    hash?: string | TestResult | null,
): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    // Check pending updates first (not yet flushed to atom)
    const pending = pendingResponseUpdates[hash] as T | undefined
    if (pending) return pending

    return (atomStore.get(responseAtom)[hash] as T) || null
}
export const getAllResponses = (): Record<string, TestResult> => {
    return atomStore.get(responseAtom) || {}
}

let pendingResponseUpdates: Record<string, TestResult> = {}
let flushScheduled = false

const flushPendingUpdates = () => {
    flushScheduled = false

    if (Object.keys(pendingResponseUpdates).length > 0) {
        const updates = pendingResponseUpdates
        pendingResponseUpdates = {}
        atomStore.set(responseAtom, (prev) => ({...prev, ...updates}))
    }
}

const scheduleFlush = () => {
    if (flushScheduled) return
    flushScheduled = true
    queueMicrotask(flushPendingUpdates)
}

export const updateResponseAtom = (metadata: Record<string, TestResult>) => {
    pendingResponseUpdates = {...pendingResponseUpdates, ...metadata}
    scheduleFlush()
}
