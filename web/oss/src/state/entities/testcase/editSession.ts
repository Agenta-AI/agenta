import {atom} from "jotai"

import {revisionDraftAtomFamily} from "../testset"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import {currentRevisionIdAtom, revisionQueryAtom, testsetNameQueryAtom} from "./queries"
import {newEntityIdsAtom, testcaseIdsAtom} from "./testcaseEntity"
import {addTestcaseAtom} from "./testcaseMutations"

// Re-export for backward compatibility
export {currentRevisionIdAtom} from "../testset"

// ============================================================================
// EMPTY REVISION INITIALIZATION
// For any empty revision, add starter columns and row to improve UX
// ============================================================================

/**
 * Initialize empty revision - adds "input" and "correct_answer" columns and one empty row
 * Only called once when revision query settles (from useTestcasesTable)
 *
 * This improves UX for ANY empty revision (v0, v1, v2, etc.) by providing
 * a starting point for users to add testcases.
 *
 * Returns true if initialized, false if skipped
 */
export const initializeEmptyRevisionAtom = atom(null, (get, set) => {
    const revisionQuery = get(revisionQueryAtom)
    const currentRevId = get(currentRevisionIdAtom)
    const serverIds = get(testcaseIdsAtom)
    const newIds = get(newEntityIdsAtom)
    const columns = get(currentColumnsAtom)

    // Only initialize if:
    // - Query has settled and returned data
    // - Query data matches current revision (not stale placeholder data)
    // - No server testcases exist (check flags.has_testcases or data.testcase_ids)
    // - No client testcases exist
    // - No columns exist yet
    // Note: Applies to ALL revisions (v0, v1, v2, etc.), not just v0
    // Check if revision has testcases using the correct schema fields:
    // - flags.has_testcases: boolean flag from API
    // - data.testcase_ids: array of testcase IDs
    const hasTestcasesInRevision =
        revisionQuery.data?.flags?.has_testcases === true ||
        (revisionQuery.data?.data?.testcase_ids?.length ?? 0) > 0

    const isEmpty =
        !revisionQuery.isPending &&
        revisionQuery.data?.id === currentRevId &&
        !hasTestcasesInRevision && // Check revision data directly
        columns.length === 0 && // No columns synced yet
        newIds.length === 0

    console.log("🔍 [InitializeEmpty] Checking if revision is empty:", {
        isPending: revisionQuery.isPending,
        revisionDataId: revisionQuery.data?.id,
        currentRevId,
        hasTestcasesFlag: revisionQuery.data?.flags?.has_testcases,
        testcaseIdsLength: revisionQuery.data?.data?.testcase_ids?.length ?? 0,
        hasTestcasesInRevision,
        serverIdsLength: serverIds.length,
        newIdsLength: newIds.length,
        columnsLength: columns.length,
        isEmpty,
    })

    if (!isEmpty) {
        console.log("⏭️ [InitializeEmpty] Skipping - revision is not empty")
        return false
    }

    console.log("✨ [InitializeEmpty] Initializing empty revision with default columns and one row")

    // Set revision name from testset name for empty revisions
    const revisionId = get(currentRevisionIdAtom)
    const testsetNameQuery = get(testsetNameQueryAtom)
    if (revisionId && testsetNameQuery.data) {
        set(revisionDraftAtomFamily(revisionId), {name: testsetNameQuery.data})
    }

    // Add default columns for empty revision
    set(addColumnAtom, "input")
    set(addColumnAtom, "correct_answer")

    // Add one empty row
    set(addTestcaseAtom)

    return true
})

// Export old name for backward compatibility (deprecated)
/**
 * @deprecated Use initializeEmptyRevisionAtom instead
 */
export const initializeV0DraftAtom = initializeEmptyRevisionAtom
