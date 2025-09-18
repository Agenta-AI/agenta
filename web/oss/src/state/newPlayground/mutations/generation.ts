import {atom} from "jotai"

import {playgroundConfigAtom} from "../core/config"
import {
    addTestInputAtom,
    addChatMessageAtom,
    deleteTestInputAtom,
    deleteChatMessageAtom,
    deleteChatHistoryItemAtom,
    clearAllResultsAtom,
} from "../core/generation"
import type {AddTestCaseParams, DeleteMessageParams} from "../types"

/**
 * Generation Mutation Atoms
 *
 * These atoms handle test case management, message operations, and result clearing.
 * Simplified operations without complex sync logic.
 */

// Add new test case (auto-detects mode from selected variant)
export const addTestCaseAtom = atom(null, (get, set, variables: Record<string, string> = {}) => {
    const config = get(playgroundConfigAtom)
    const selectedVariant = config.variants[config.selectedVariantId]

    if (!selectedVariant) {
        console.error("❌ No selected variant for adding test case")
        return null
    }

    if (selectedVariant.isChatVariant) {
        const addChatMessage = get(addChatMessageAtom)
        return addChatMessage(variables)
    } else {
        const addTestInput = get(addTestInputAtom)
        return addTestInput(variables)
    }
})

// Add test case with explicit mode
export const addTestCaseWithModeAtom = atom(null, (get, set, params: AddTestCaseParams) => {
    const {mode, variables = {}} = params

    if (mode === "chat") {
        const addChatMessage = get(addChatMessageAtom)
        return addChatMessage(variables)
    } else {
        const addTestInput = get(addTestInputAtom)
        return addTestInput(variables)
    }
})

// Delete test case (auto-detects type)
export const deleteTestCaseAtom = atom(null, (get, set, rowId: string) => {
    const config = get(playgroundConfigAtom)
    const selectedVariant = config.variants[config.selectedVariantId]

    if (!selectedVariant) {
        console.error("❌ No selected variant for deleting test case")
        return
    }

    if (selectedVariant.isChatVariant) {
        const deleteChatMessage = get(deleteChatMessageAtom)
        deleteChatMessage(rowId)
    } else {
        const deleteTestInput = get(deleteTestInputAtom)
        deleteTestInput(rowId)
    }
})

// Delete specific chat message/history item
export const deleteMessageAtom = atom(null, (get, set, params: DeleteMessageParams) => {
    const deleteChatHistoryItem = get(deleteChatHistoryItemAtom)
    deleteChatHistoryItem(params)
})

// Clear all test results
export const clearResultsAtom = atom(null, (get, set) => {
    const clearResults = get(clearAllResultsAtom)
    clearResults()
})

// Duplicate test case
export const duplicateTestCaseAtom = atom(null, (get, set, rowId: string) => {
    // TODO: Implement test case duplication
    // This would involve finding the source row and creating a copy
    console.warn("duplicateTestCaseAtom not yet implemented")
})

// Update test case variables
export const updateTestCaseVariablesAtom = atom(
    null,
    (
        get,
        set,
        params: {
            rowId: string
            variables: Record<string, string>
        },
    ) => {
        // TODO: Implement test case variable updates
        // This would involve updating the variable values in the target row
        console.warn("updateTestCaseVariablesAtom not yet implemented")
    },
)

// Bulk operations
export const bulkDeleteTestCasesAtom = atom(null, (get, set, rowIds: string[]) => {
    const deleteTestCase = get(deleteTestCaseAtom)

    rowIds.forEach((rowId) => {
        deleteTestCase(rowId)
    })
})

export const bulkClearResultsAtom = atom(
    null,
    (
        get,
        set,
        params: {
            rowIds?: string[]
            variantIds?: string[]
        },
    ) => {
        // TODO: Implement selective result clearing
        // For now, clear all results
        const clearResults = get(clearResultsAtom)
        clearResults()
    },
)
