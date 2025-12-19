// ============================================================================
// TESTCASE-LEVEL DIRTY STATE
// Only concerned with individual testcase dirty checking
// For revision-level dirty state, see testset/dirtyState.ts
// ============================================================================

/**
 * Check if a specific testcase has unsaved changes
 *
 * **This is the ONLY dirty checking API you should use for individual testcases.**
 *
 * Comprehensively checks:
 * - Cell edits (draft vs server state)
 * - Pending column renames
 * - Pending column deletions
 * - Pending column additions
 *
 * @example
 * ```tsx
 * // In React components
 * const isDirty = useAtomValue(testcaseIsDirtyAtom(testcaseId))
 *
 * // In callbacks (non-reactive)
 * const isDirty = globalStore.get(testcaseIsDirtyAtom(testcaseId))
 * ```
 */
export {testcaseIsDirtyAtomFamily as testcaseIsDirtyAtom} from "./testcaseEntity"

// Re-export from testset module for backward compatibility
// These are revision-level concerns and live in testset/dirtyState.ts
export {
    hasAnyTestcaseDirtyAtom,
    hasUnsavedChangesAtom,
    changesSummaryAtom,
    type ChangesSummary,
} from "../testset/dirtyState"
