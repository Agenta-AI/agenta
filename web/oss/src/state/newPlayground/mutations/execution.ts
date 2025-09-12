import {atom} from "jotai"

import {triggerWebWorkerTestAtom} from "@/oss/components/Playground/state/atoms/webWorkerIntegration"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"

import {playgroundConfigAtom} from "../core/config"
import {generationDataAtom, updateTestRunAtom} from "../core/generation"
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
    const triggerWebWorkerTest = get(triggerWebWorkerTestAtom)
    await triggerWebWorkerTest({rowId, variantId})

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
    const {rowId, variantId} = params

    // Clear loading state
    const updateTestRun = get(updateTestRunAtom)
    updateTestRun({rowId, variantId, isRunning: false})

    // Remove from pending requests
    set(pendingWebWorkerRequestsAtom, (prev) => {
        const filtered = Object.entries(prev).reduce(
            (acc, [runId, request]) => {
                if (request.rowId !== rowId || request.variantId !== variantId) {
                    acc[runId] = request
                }
                return acc
            },
            {} as typeof prev,
        )

        return filtered
    })
})

// Cancel all tests
export const cancelAllTestsAtom = atom(null, (get, set) => {
    const generationData = get(generationDataAtom)
    const config = get(playgroundConfigAtom)
    const updateTestRun = get(updateTestRunAtom)

    // Clear all loading states
    const allRows = [...generationData.inputs, ...generationData.messages]

    for (const row of allRows) {
        for (const variantId of config.displayedVariantIds) {
            updateTestRun({rowId: row.__id, variantId, isRunning: false})
        }
    }

    // Clear all pending requests
    set(pendingWebWorkerRequestsAtom, {})
})

// Handle web worker result (called by web worker integration)
export const handleWebWorkerResultAtom = atom(
    null,
    (
        get,
        set,
        payload: {
            rowId: string
            variantId: string
            runId: string
            result?: any
            error?: any
            messageId?: string
        },
    ) => {
        const {rowId, variantId, runId, result, error, messageId} = payload

        // Remove from pending requests
        set(pendingWebWorkerRequestsAtom, (prev) => {
            const {[runId]: removed, ...rest} = prev
            return rest
        })

        // Update test run with result or error
        const updateTestRun = get(updateTestRunAtom)

        if (error) {
            updateTestRun({rowId, variantId, error, isRunning: false})
        } else if (result) {
            updateTestRun({rowId, variantId, result, isRunning: false})
        }

        // For chat variants, handle message creation
        if (messageId && result) {
            // TODO: Handle chat message result storage
            // This would involve updating the chat history with the assistant response
        }
    },
)
