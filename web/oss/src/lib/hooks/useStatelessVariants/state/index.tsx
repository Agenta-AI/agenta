/**
 * Stateless Variants State Module
 *
 * Metadata: Re-exports from @agenta/entities/legacyAppRevision (single source of truth).
 * Response store: Playground-specific, stays here.
 */

import {atom, getDefaultStore} from "jotai"

import {TestResult} from "@/oss/lib/shared/variant/transformer/types"

// ============================================================================
// METADATA — re-exported from entity package (single source of truth)
// This file is an intentional re-export facade so 26+ existing consumers
// keep their import path unchanged after the metadata store unification.
// ============================================================================

/* eslint-disable no-restricted-syntax -- bridge facade: re-exports for backward compat */
export {
    metadataAtom,
    metadataSelectorFamily,
    updateMetadataAtom,
    getMetadataLazy,
    getAllMetadata,
    type ConfigMetadata,
} from "@agenta/entities/legacyAppRevision"

// Backward-compatible alias: mergedMetadataAtom was the dual-store merge atom.
// Now that entity is the single source, it's just the entity's metadataAtom.
export {metadataAtom as mergedMetadataAtom} from "@agenta/entities/legacyAppRevision"
/* eslint-enable no-restricted-syntax */

// ============================================================================
// RESPONSE STORE — playground-specific, no entity equivalent
// ============================================================================

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
