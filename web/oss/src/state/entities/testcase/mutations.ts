// ============================================================================
// MUTATIONS RE-EXPORTS
// This file re-exports mutations from their proper locations for backward compatibility
// - Revision-level mutations: testset/mutations.ts
// - Testcase-level mutations: testcase/testcaseMutations.ts
// ============================================================================

// Revision-level mutations (save, clear changes)
export {
    saveTestsetAtom,
    clearChangesAtom,
    type SaveTestsetParams,
    type SaveTestsetResult,
} from "../testset/mutations"

// Testcase-level mutations (add, delete, append)
export {
    addTestcaseAtom,
    appendTestcasesAtom,
    deleteTestcasesAtom,
    type AddTestcaseResult,
} from "./testcaseMutations"
