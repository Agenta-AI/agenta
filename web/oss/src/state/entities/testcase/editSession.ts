import {atom} from "jotai"

import {currentRevisionIdAtom} from "../testset"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import {revisionQueryAtom, testsetIdAtom} from "./queries"
import {
    addNewEntityIdAtom,
    newEntityIdsAtom,
    testcaseDraftAtomFamily,
    testcaseIdsAtom,
} from "./testcaseEntity"

// Re-export for backward compatibility
export {currentRevisionIdAtom} from "../testset"

// ============================================================================
// V0 DRAFT INITIALIZATION
// Automatically initializes empty testsets with a starter column and row
// ============================================================================

/**
 * Tracks whether v0 draft has been initialized for the current revision
 * Resets when revision changes
 */
const v0DraftInitializedAtom = atom<{revisionId: string | null; initialized: boolean}>({
    revisionId: null,
    initialized: false,
})

/**
 * Derived atom that checks if v0 draft should be initialized
 * Returns true if conditions are met and not yet initialized
 */
export const shouldInitializeV0DraftAtom = atom((get) => {
    const revisionId = get(currentRevisionIdAtom)
    const revisionQuery = get(revisionQueryAtom)
    const revisionVersion = revisionQuery.data?.version
    const testsetId = get(testsetIdAtom)
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const columns = get(currentColumnsAtom)
    const initState = get(v0DraftInitializedAtom)

    // Reset check if revision changed
    if (initState.revisionId !== revisionId) {
        return {shouldInit: false, needsReset: true, revisionId}
    }

    // Already initialized for this revision
    if (initState.initialized) {
        return {shouldInit: false, needsReset: false, revisionId}
    }

    // Check conditions - version is normalized to number by Zod schema
    const isV0 = revisionVersion === 0
    const hasNoServerData = serverIds.length === 0
    const hasNoLocalData = newIds.length === 0 && columns.length === 0

    const shouldInit = isV0 && hasNoServerData && hasNoLocalData && !!testsetId

    return {
        shouldInit,
        needsReset: false,
        revisionId,
        testsetId,
    }
})

/**
 * Write atom to initialize v0 draft state
 * Creates an "input" column and an empty row
 */
export const initializeV0DraftAtom = atom(null, (get, set) => {
    let check = get(shouldInitializeV0DraftAtom)

    // Handle revision change - reset initialized state and re-check
    if (check.needsReset) {
        set(v0DraftInitializedAtom, {revisionId: check.revisionId, initialized: false})
        // Re-read after reset to check if we should initialize
        check = get(shouldInitializeV0DraftAtom)
    }

    if (!check.shouldInit) {
        return false
    }

    const testsetId = check.testsetId as string

    // Mark as initialized first to prevent re-runs
    set(v0DraftInitializedAtom, {revisionId: check.revisionId, initialized: true})

    // Add example column
    set(addColumnAtom, "input")

    // Add example row with empty data
    const newRowId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    // Add to new entity IDs
    set(addNewEntityIdAtom, newRowId)

    // Create draft for the new entity
    set(testcaseDraftAtomFamily(newRowId), {
        id: newRowId,
        testset_id: testsetId,
        input: "",
    })

    return true
})
