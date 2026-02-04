import {
    updateMetadataAtom as entityUpdateMetadataAtom,
    getMetadataLazy as entityGetMetadataLazy,
    getAllMetadata as entityGetAllMetadata,
    type ConfigMetadata as EntityConfigMetadata,
} from "@agenta/entities/legacyAppRevision"
import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

// Import the unified metadata atom from entity package
// This ensures both OSS and entity package share the same metadata store

import {ConfigMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {TestResult} from "@/oss/lib/shared/variant/transformer/types"

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
let pendingMetadataUpdates: Record<string, ConfigMetadata> = {}
let flushScheduled = false

const flushPendingUpdates = () => {
    flushScheduled = false

    if (Object.keys(pendingResponseUpdates).length > 0) {
        const updates = pendingResponseUpdates
        pendingResponseUpdates = {}
        atomStore.set(responseAtom, (prev) => ({...prev, ...updates}))
    }

    if (Object.keys(pendingMetadataUpdates).length > 0) {
        const updates = pendingMetadataUpdates
        pendingMetadataUpdates = {}
        // Update both local and entity metadata atoms for compatibility
        atomStore.set(metadataAtom, (prev) => ({...prev, ...updates}))
        entityUpdateMetadataAtom(updates as Record<string, EntityConfigMetadata>)
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

// Atom to store metadata - keep local for OSS compatibility
// but also sync to entity package's metadata atom
export const metadataAtom = atom<Record<string, ConfigMetadata>>({})
// Per-key selector family to avoid re-renders on unrelated keys
export const metadataSelectorFamily = atomFamily((hash: string | undefined) =>
    selectAtom(
        metadataAtom,
        (m) => (hash ? (m[hash] as ConfigMetadata | undefined) : undefined),
        Object.is,
    ),
)
// Lazy reader for metadata - check both local and entity stores
export const getMetadataLazy = <T extends ConfigMetadata>(hash?: string | T): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    // Try local store first, then entity store
    const local = atomStore.get(metadataAtom)[hash] as T | undefined
    if (local) return local

    // Fall back to entity store
    return entityGetMetadataLazy(hash) as T | null
}
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    // Merge both stores
    const local = atomStore.get(metadataAtom) || {}
    const entity = entityGetAllMetadata() || {}
    return {...entity, ...local} as Record<string, ConfigMetadata>
}

export const updateMetadataAtom = (metadata: Record<string, ConfigMetadata>) => {
    pendingMetadataUpdates = {...pendingMetadataUpdates, ...metadata}
    scheduleFlush()
}
