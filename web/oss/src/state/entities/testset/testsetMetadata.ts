import {atom} from "jotai"

import {testcasesRevisionIdAtom} from "@/oss/components/TestcasesTableNew/atoms/tableStore"

import {
    clearRevisionDraftAtom,
    revisionDraftAtomFamily,
    revisionEntityAtomFamily,
    revisionHasDraftAtomFamily,
} from "./revisionEntity"

// ============================================================================
// TESTSET METADATA
// All metadata is stored in revision entity - uses revisionDraftAtomFamily
// for local edits (same pattern as testcases)
// ============================================================================

/**
 * Current revision ID context - derived from tableStore's revisionIdAtom
 * This is the single source of truth for the current revision being edited
 */
export const currentRevisionIdAtom = atom(
    (get) => get(testcasesRevisionIdAtom),
    (_get, set, value: string | null) => set(testcasesRevisionIdAtom, value),
)

// ============================================================================
// CURRENT VALUE ATOMS
// Read from revision entity (server + draft merged)
// ============================================================================

/**
 * Current name - from revision entity (draft merged with server)
 */
export const currentTestsetNameAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return ""

    const entity = get(revisionEntityAtomFamily(revisionId))
    return entity?.name ?? ""
})

/**
 * Current description/message - from revision entity (draft merged with server)
 */
export const currentDescriptionAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return ""

    const entity = get(revisionEntityAtomFamily(revisionId))
    return entity?.message ?? ""
})

// ============================================================================
// WRITE ATOMS
// Set local draft values via revisionDraftAtomFamily
// ============================================================================

/**
 * Set local name via revision draft
 */
export const setLocalTestsetNameAtom = atom(null, (get, set, name: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    const currentDraft = get(revisionDraftAtomFamily(revisionId))
    set(revisionDraftAtomFamily(revisionId), {
        ...currentDraft,
        name,
    })
})

/**
 * Set local description (commit message) via revision draft
 */
export const setLocalDescriptionAtom = atom(null, (get, set, description: string) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return

    const currentDraft = get(revisionDraftAtomFamily(revisionId))
    set(revisionDraftAtomFamily(revisionId), {
        ...currentDraft,
        message: description,
    })
})

/**
 * Reset metadata draft (clear local edits)
 */
export const resetMetadataDraftAtom = atom(null, (get, set) => {
    const revisionId = get(currentRevisionIdAtom)
    if (revisionId) {
        set(clearRevisionDraftAtom, revisionId)
    }
})

// ============================================================================
// DIRTY STATE ATOMS
// Check if metadata has been edited (via revision draft)
// ============================================================================

/**
 * Check if name has changed (via revision draft)
 */
export const testsetNameChangedAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return false

    const draft = get(revisionDraftAtomFamily(revisionId))
    return draft?.name !== undefined
})

/**
 * Check if description has changed (via revision draft)
 */
export const descriptionChangedAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return false

    const draft = get(revisionDraftAtomFamily(revisionId))
    return draft?.message !== undefined
})

/**
 * Check if any metadata has changed
 */
export const hasMetadataChangesAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return false
    return get(revisionHasDraftAtomFamily(revisionId))
})

// ============================================================================
// DERIVED ATOMS
// Additional derived state from revision entity
// ============================================================================

/**
 * Current testset ID - derived from revision entity
 */
export const currentTestsetIdAtom = atom((get): string | null => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return null

    const entity = get(revisionEntityAtomFamily(revisionId))
    return entity?.testset_id ?? null
})

/**
 * Current revision version - derived from revision entity
 */
export const currentRevisionVersionAtom = atom((get): number | undefined => {
    const revisionId = get(currentRevisionIdAtom)
    if (!revisionId) return undefined

    const entity = get(revisionEntityAtomFamily(revisionId))
    return entity?.version
})
