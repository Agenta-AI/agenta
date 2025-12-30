import {atom} from "jotai"

import {revisionDraftAtomFamily} from "../testset"

import {addColumnAtom, currentColumnsAtom} from "./columnState"
import {currentRevisionIdAtom, revisionQueryAtom, testsetDetailQueryAtom} from "./queries"
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
 * IMPORTANT: This should ONLY initialize client-only revisions ("new", "draft").
 * Real server revisions (UUIDs) should never be initialized with placeholders,
 * even if they appear empty during data loading transitions.
 *
 * Returns true if initialized, false if skipped
 */
export const initializeEmptyRevisionAtom = atom(null, (get, set) => {
    const revisionQuery = get(revisionQueryAtom)
    const currentRevId = get(currentRevisionIdAtom)
    const newIds = get(newEntityIdsAtom)
    const columns = get(currentColumnsAtom)
    const loadedTestcaseIds = get(testcaseIdsAtom)

    // CRITICAL: Only initialize client-only revisions ("new", "draft")
    // Real server revisions should never get placeholders, even if they appear empty
    // during data loading transitions (race condition between cleanup and data fetch)
    const isClientOnlyRevision = currentRevId === "new" || currentRevId === "draft"

    // Only initialize if:
    // - This is a client-only revision (not a real server revision)
    // - Query has settled and returned data
    // - Query data matches current revision (not stale placeholder data)
    // - No server testcases exist (check flags.has_testcases or data.testcase_ids)
    // - No client testcases exist
    // - No columns exist yet
    // Check if revision has testcases using the correct schema fields:
    // - flags.has_testcases: boolean flag from API
    // - data.testcase_ids: array of testcase IDs
    const hasTestcasesInRevision =
        revisionQuery.data?.flags?.has_testcases === true ||
        (revisionQuery.data?.data?.testcase_ids?.length ?? 0) > 0

    // CRITICAL FIX: Don't initialize if testcases have already started loading
    // This happens when table store fetches data but columns haven't synced yet
    // Without this check, we get flaky behavior where placeholders appear even for revisions with data
    const testcasesAlreadyLoaded = loadedTestcaseIds.length > 0

    const isEmpty =
        isClientOnlyRevision && // ONLY initialize client-only revisions
        !revisionQuery.isPending &&
        revisionQuery.data?.id === currentRevId &&
        !hasTestcasesInRevision && // Check revision data directly
        !testcasesAlreadyLoaded && // Don't initialize if data is already loading/loaded
        columns.length === 0 && // No columns synced yet
        newIds.length === 0

    console.log("[initializeEmptyRevisionAtom] Checking initialization:", {
        revisionId: currentRevId,
        isClientOnlyRevision,
        isPending: revisionQuery.isPending,
        queryDataMatchesCurrent: revisionQuery.data?.id === currentRevId,
        hasTestcasesInRevision,
        testcasesAlreadyLoaded,
        loadedTestcaseIdsLength: loadedTestcaseIds.length,
        columnsLength: columns.length,
        newIdsLength: newIds.length,
        isEmpty,
    })

    if (!isEmpty) {
        return false
    }

    console.log("[initializeEmptyRevisionAtom] Initializing empty revision:", currentRevId)

    // Set revision name from testset name for empty revisions
    const revisionId = get(currentRevisionIdAtom)
    const testset = get(testsetDetailQueryAtom)
    if (revisionId && testset?.name) {
        set(revisionDraftAtomFamily(revisionId), {name: testset.name})
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
