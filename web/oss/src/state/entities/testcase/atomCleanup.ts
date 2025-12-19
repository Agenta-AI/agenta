import {atom} from "jotai"

import {testcaseIdsAtom} from "./testcaseEntity"

// ============================================================================
// ATOM FAMILY CLEANUP
// Prevents memory leaks by cleaning up unused atoms when switching revisions
// ============================================================================

/**
 * Registry of all atomFamily instances that need cleanup
 * This will be populated by testcaseEntity.ts
 */
export const atomFamilyRegistry: {
    testcaseQuery?: any
    testcaseDraft?: any
    testcaseEntity?: any
    testcaseHasDraft?: any
    testcaseServerState?: any
    testcaseIsDirty?: any
    testcaseCell?: any
} = {}

/**
 * Track current columns for cell cleanup
 */
let currentColumns: string[] = []

export function setCurrentColumnsForCleanup(columns: string[]) {
    currentColumns = columns
}

/**
 * Cleanup atoms for a specific testcase
 * Removes the testcase from all atomFamily instances
 *
 * @param testcaseId - The ID of the testcase to cleanup
 */
export function cleanupTestcaseAtoms(testcaseId: string) {
    // Remove from scalar atomFamilies
    atomFamilyRegistry.testcaseQuery?.remove(testcaseId)
    atomFamilyRegistry.testcaseDraft?.remove(testcaseId)
    atomFamilyRegistry.testcaseEntity?.remove(testcaseId)
    atomFamilyRegistry.testcaseHasDraft?.remove(testcaseId)
    atomFamilyRegistry.testcaseServerState?.remove(testcaseId)
    atomFamilyRegistry.testcaseIsDirty?.remove(testcaseId)

    // Remove from composite-key atomFamilies (testcaseCell uses {id, column})
    if (atomFamilyRegistry.testcaseCell && currentColumns.length > 0) {
        currentColumns.forEach((columnKey) => {
            const cellKey = JSON.stringify({id: testcaseId, column: columnKey})
            atomFamilyRegistry.testcaseCell.remove(cellKey)
        })
    }
}

/**
 * Cleanup atoms for multiple testcases
 * Used when switching revisions to clear old data
 *
 * @param testcaseIds - Array of testcase IDs to cleanup
 */
export function cleanupTestcaseAtomsBatch(testcaseIds: string[]) {
    if (!testcaseIds.length) return

    testcaseIds.forEach((id) => cleanupTestcaseAtoms(id))

    if (process.env.NODE_ENV === "development") {
        console.log(`[AtomCleanup] Removed ${testcaseIds.length} testcase atoms`)
    }
}

/**
 * Atom to track previous revision ID for cleanup
 */
const previousRevisionIdAtom = atom<string | null>(null)

/**
 * Write-only atom to cleanup atoms when revision changes
 * Call this from your hook when revisionId changes
 *
 * @example
 * ```tsx
 * const cleanupOnRevisionChange = useSetAtom(cleanupOnRevisionChangeAtom)
 *
 * useEffect(() => {
 *   cleanupOnRevisionChange(revisionId)
 * }, [revisionId, cleanupOnRevisionChange])
 * ```
 */
export const cleanupOnRevisionChangeAtom = atom(
    null,
    (get, set, newRevisionId: string | null) => {
        const previousRevisionId = get(previousRevisionIdAtom)

        // Skip if revision hasn't changed
        if (previousRevisionId === newRevisionId) return

        // If we have a previous revision, cleanup its testcases
        if (previousRevisionId !== null) {
            const oldTestcaseIds = get(testcaseIdsAtom)
            cleanupTestcaseAtomsBatch(oldTestcaseIds)
        }

        // Update tracked revision
        set(previousRevisionIdAtom, newRevisionId)
    },
)

/**
 * Write-only atom to force cleanup of all current testcase atoms
 * Useful for manual cleanup or when unmounting
 */
export const cleanupAllTestcaseAtomsAtom = atom(null, (get, set) => {
    const testcaseIds = get(testcaseIdsAtom)
    cleanupTestcaseAtomsBatch(testcaseIds)
})
