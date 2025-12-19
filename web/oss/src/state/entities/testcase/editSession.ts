import {atom} from "jotai"

import {revisionDraftAtomFamily} from "../testset"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import {currentRevisionIdAtom, revisionQueryAtom, testsetNameQueryAtom} from "./queries"
import {newEntityIdsAtom, testcaseIdsAtom} from "./testcaseEntity"
import {addTestcaseAtom} from "./testcaseMutations"

// Re-export for backward compatibility
export {currentRevisionIdAtom} from "../testset"

// ============================================================================
// V0 DRAFT INITIALIZATION
// For new testsets (v0), add a starter column and row
// ============================================================================

/**
 * Initialize v0 draft - adds "input" column and one empty row
 * Only called once when revision query settles (from useTestcasesTable)
 *
 * Returns true if initialized, false if skipped
 */
export const initializeV0DraftAtom = atom(null, (get, set) => {
    const revisionQuery = get(revisionQueryAtom)
    const currentRevId = get(currentRevisionIdAtom)
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const columns = get(currentColumnsAtom)

    // Only initialize if:
    // - Query has settled and returned data
    // - Query data matches current revision (not stale placeholder data)
    // - Version is 0
    // - No server testcases exist
    // - No client testcases exist
    // - No columns exist yet
    const isV0Empty =
        !revisionQuery.isPending &&
        revisionQuery.data?.id === currentRevId &&
        revisionQuery.data?.version === 0 &&
        serverIds.length === 0 &&
        newIds.length === 0 &&
        columns.length === 0

    if (!isV0Empty) {
        return false
    }

    // Set revision name from testset name for v0
    const revisionId = get(currentRevisionIdAtom)
    const testsetNameQuery = get(testsetNameQueryAtom)
    if (revisionId && testsetNameQuery.data) {
        set(revisionDraftAtomFamily(revisionId), {name: testsetNameQuery.data})
    }

    // Add default columns for new testset
    set(addColumnAtom, "input")
    set(addColumnAtom, "correct_answer")

    // Add one empty row
    set(addTestcaseAtom)

    return true
})
