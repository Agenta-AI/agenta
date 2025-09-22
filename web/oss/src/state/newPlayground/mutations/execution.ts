import {atom} from "jotai"

// Use local bridge to decouple from legacy folder
import {cancelTestsMutationAtom} from "@/oss/components/Playground/state/atoms"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {triggerWebWorkerTestAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import {playgroundConfigAtom} from "../core/config"
import {generationDataAtom} from "../core/generation"
import type {RunTestParams} from "../types"

/**
 * Test Execution Atoms
 *
 * These atoms handle test execution via web worker integration.
 * Clean separation from config management with optimized execution flow.
 */

// Store pending web worker requests for tracking
export const pendingWebWorkerRequestsAtom = atom<
    Record<
        string,
        {
            rowId: string
            variantId: string
            runId: string
            timestamp: number
        }
    >
>({})

// Execute single test - reuses existing triggerWebWorkerTestAtom
export const runSingleTestAtom = atom(null, async (get, set, params: RunTestParams) => {
    const {rowId, variantId} = params

    // Simply delegate to existing web worker integration
    set(triggerWebWorkerTestAtom, {rowId, variantId})

    return generateId() // Return a run ID for consistency
})

// Execute tests for all displayed variants on a specific row
export const runRowTestsAtom = atom(null, async (get, set, rowId: string) => {
    const config = get(playgroundConfigAtom)
    const runSingleTest = get(runSingleTestAtom)

    const runIds: string[] = []

    // Execute test for each displayed variant
    for (const variantId of config.displayedVariantIds) {
        const runId = await runSingleTest({rowId, variantId})
        if (runId) {
            runIds.push(runId)
        }
    }

    return runIds
})

// Execute all tests (all rows, all variants)
export const runAllTestsAtom = atom(null, async (get, set) => {
    const generationData = get(generationDataAtom)
    const config = get(playgroundConfigAtom)
    const runSingleTest = get(runSingleTestAtom)

    const runIds: string[] = []

    // Get all rows (inputs + messages)
    const allRows = [...generationData.inputs, ...generationData.messages]

    // Execute test for each row and each displayed variant
    for (const row of allRows) {
        for (const variantId of config.displayedVariantIds) {
            const runId = await runSingleTest({rowId: row.__id, variantId})
            if (runId) {
                runIds.push(runId)
            }
        }
    }

    return runIds
})

// Cancel specific test
export const cancelTestAtom = atom(null, (get, set, params: {rowId: string; variantId: string}) => {
    set(cancelTestsMutationAtom, params)
})

// Cancel all tests
export const cancelAllTestsAtom = atom(null, (_get, set) => {
    set(cancelTestsMutationAtom, {})
})
