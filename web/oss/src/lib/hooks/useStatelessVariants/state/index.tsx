import {atom, getDefaultStore} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

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
        atomStore.set(metadataAtom, (prev) => ({...prev, ...updates}))
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

// Atom to store metadata
export const metadataAtom = atom<Record<string, ConfigMetadata>>({})
// Per-key selector family to avoid re-renders on unrelated keys
export const metadataSelectorFamily = atomFamily((hash: string | undefined) =>
    selectAtom(
        metadataAtom,
        (m) => (hash ? (m[hash] as ConfigMetadata | undefined) : undefined),
        Object.is,
    ),
)
// Lazy reader for metadata
export const getMetadataLazy = <T extends ConfigMetadata>(hash?: string | T): T | null => {
    if (!hash) return null
    if (typeof hash !== "string") {
        return hash as T
    }

    return (atomStore.get(metadataAtom)[hash] as T) || null
}
export const getAllMetadata = (): Record<string, ConfigMetadata> => {
    return atomStore.get(metadataAtom) || {}
}

export const updateMetadataAtom = (metadata: Record<string, ConfigMetadata>) => {
    pendingMetadataUpdates = {...pendingMetadataUpdates, ...metadata}
    scheduleFlush()
}
