import {atom} from "jotai"

// ============================================================================
// REVISION CONTEXT
// Tracks the current testset and revision being edited
// ============================================================================

/**
 * Current testset ID being edited
 */
export const currentTestsetIdAtom = atom<string | null>(null)

/**
 * Current revision ID being edited
 */
export const currentRevisionIdAtom = atom<string | null>(null)

/**
 * Current revision version number
 */
export const currentRevisionVersionAtom = atom<number | null>(null)

/**
 * Revision metadata
 */
export interface RevisionMetadata {
    message?: string
    author?: string
    createdAt?: string
    updatedAt?: string
}

/**
 * Current revision metadata
 */
export const revisionMetadataAtom = atom<RevisionMetadata | null>(null)

/**
 * Write-only atom to set the current revision context
 */
export const setRevisionContextAtom = atom(
    null,
    (
        _get,
        set,
        context: {
            testsetId: string
            revisionId: string
            version?: number
            metadata?: RevisionMetadata
        },
    ) => {
        set(currentTestsetIdAtom, context.testsetId)
        set(currentRevisionIdAtom, context.revisionId)
        set(currentRevisionVersionAtom, context.version ?? null)
        set(revisionMetadataAtom, context.metadata ?? null)
    },
)

/**
 * Write-only atom to clear the revision context
 * Call this when navigating away from testset editing
 */
export const clearRevisionContextAtom = atom(null, (_get, set) => {
    set(currentTestsetIdAtom, null)
    set(currentRevisionIdAtom, null)
    set(currentRevisionVersionAtom, null)
    set(revisionMetadataAtom, null)
})

/**
 * Derived atom to check if we have a valid revision context
 */
export const hasRevisionContextAtom = atom((get) => {
    return get(currentTestsetIdAtom) !== null && get(currentRevisionIdAtom) !== null
})
