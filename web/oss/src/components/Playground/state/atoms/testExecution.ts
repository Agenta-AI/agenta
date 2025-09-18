import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {runStatusByRowRevisionAtom, chatTurnsByIdAtom} from "@/oss/state/generation/entities"
import {
    responseByRowRevisionAtomFamily,
    loadingByRowRevisionAtomFamily,
} from "@/oss/state/newPlayground/generation/runtime"
import {pendingWebWorkerRequestsAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import type {CancelTestsParams, TestExecutionResult} from "../types"

import {testRunStatesAtom, selectedVariantsAtom} from "./core"

/**
 * Phase 4.4: Test Execution Mutation Atoms
 * Atoms for running tests, canceling tests, and rerunning chat outputs
 */

// Cancel tests mutation atom
export const cancelTestsMutationAtom = atom(
    null,
    async (get, set, params: CancelTestsParams): Promise<TestExecutionResult> => {
        try {
            const {rowId, variantId, variantIds: paramVariantIds, reason} = params || {}

            // Resolve target variants
            const targetVariantIds =
                paramVariantIds ?? (variantId ? [variantId] : get(selectedVariantsAtom))

            // 1) Update test run states (if used elsewhere)
            set(testRunStatesAtom, (prev) =>
                produce(prev, (draft) => {
                    for (const vId of targetVariantIds) {
                        if (draft[vId]) {
                            Object.keys(draft[vId]).forEach((rowKey) => {
                                if (draft[vId][rowKey].__isRunning === "true") {
                                    draft[vId][rowKey] = {
                                        __isRunning: "false",
                                        __result: "",
                                        __error: reason || "Test execution cancelled by user",
                                        startTime: draft[vId][rowKey].startTime || Date.now(),
                                        endTime: Date.now(),
                                    }
                                }
                            })
                        }
                    }
                }),
            )

            // 2) Signal web worker to abort matching in-flight runs
            const webWorker = (window as any).__playgroundWebWorker
            if (webWorker) {
                const {postMessageToWorker, createWorkerMessage} = webWorker
                const pending = get(pendingWebWorkerRequestsAtom)
                const runIdsToCancel: string[] = []

                Object.values(pending).forEach((req) => {
                    const matchesVariant = targetVariantIds.includes(req.variantId)
                    const matchesRow = rowId ? req.rowId === rowId : true
                    if (matchesVariant && matchesRow) {
                        runIdsToCancel.push(req.runId)
                    }
                })

                runIdsToCancel.forEach((rid) => {
                    try {
                        postMessageToWorker(createWorkerMessage("cancelRun", {runId: rid}))
                    } catch (e) {
                        console.warn("Failed to post cancelRun to worker", e)
                    }
                })

                // Remove cancelled runs from pending list
                if (runIdsToCancel.length > 0) {
                    set(pendingWebWorkerRequestsAtom, (prev) => {
                        const next = {...prev}
                        runIdsToCancel.forEach((rid) => delete next[rid])
                        return next
                    })
                }
            }

            // 3) Clear running flags in normalized run status and loading atoms
            set(runStatusByRowRevisionAtom, (prev) => {
                const next = {...prev}
                Object.entries(prev).forEach(([key, entry]) => {
                    const [kRowId, kVarId] = key.split(":")
                    const matchesVariant = targetVariantIds.includes(kVarId)
                    const matchesRow = rowId ? kRowId === rowId : true
                    if (matchesVariant && matchesRow)
                        next[key] = {isRunning: false, resultHash: entry?.resultHash ?? null}
                })
                return next
            })
            try {
                const status = get(runStatusByRowRevisionAtom)
                Object.keys(status || {}).forEach((key) => {
                    const [kRowId, kVarId] = key.split(":")
                    const matchesVariant = targetVariantIds.includes(kVarId)
                    const matchesRow = rowId ? kRowId === rowId : true
                    if (matchesVariant && matchesRow) {
                        set(
                            loadingByRowRevisionAtomFamily({rowId: kRowId, revisionId: kVarId}),
                            false,
                        )
                    }
                })
            } catch {}

            return {
                success: true,
                message: "Tests cancelled successfully",
                results: [],
                summary: {total: 0, successful: 0, failed: 0},
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : "Failed to cancel tests",
                results: [],
                summary: {total: 0, successful: 0, failed: 0},
            }
        }
    },
)

// Clear test results mutation atom
export const clearTestResultsMutationAtom = atom(null, (get, set, variantIds?: string[]) => {
    // Clear test run states
    set(testRunStatesAtom, (prev) =>
        produce(prev, (draft) => {
            if (variantIds) {
                // Clear specific variants
                for (const variantId of variantIds) {
                    delete draft[variantId]
                }
            } else {
                // Clear all test results
                Object.keys(draft).forEach((variantId) => {
                    delete draft[variantId]
                })
            }
        }),
    )

    // Also clear normalized per-(row,revision) responses and status
    const status = get(runStatusByRowRevisionAtom)
    Object.keys(status || {}).forEach((key) => {
        const [rowId, revId] = key.split(":")
        if (!variantIds || variantIds.includes(revId)) {
            try {
                set(responseByRowRevisionAtomFamily({rowId, revisionId: revId}), undefined as any)
            } catch {}
            set(runStatusByRowRevisionAtom, (prev) => ({
                ...prev,
                [key]: {isRunning: false, resultHash: null},
            }))
            try {
                set(loadingByRowRevisionAtomFamily({rowId, revisionId: revId}), false)
            } catch {}
        }
    })

    if (process.env.NODE_ENV === "development") {
        console.log("✅ All runs cleared")
    }
})

// Get test status for variant atom family (proper atomFamily)
export const testStatusAtomFamily = atomFamily((variantId: string) =>
    atom((get) => {
        const _testConfig = get(testConfigAtom)
        const testStates = get(testRunStatesAtom)
        const variantTests = testStates[variantId] || {}

        const allTests = Object.values(variantTests)
        const runningTests = allTests.filter((test) => test.__isRunning === "true")
        const completedTests = allTests.filter((test) => test.__isRunning === "false")
        const errorTests = completedTests.filter((test) => test.__error)
        const successTests = completedTests.filter((test) => !test.__error)

        return {
            isRunning: runningTests.length > 0,
            total: allTests.length,
            running: runningTests.length,
            completed: completedTests.length,
            successful: successTests.length,
            failed: errorTests.length,
            hasResults: allTests.length > 0,
        }
    }),
)
