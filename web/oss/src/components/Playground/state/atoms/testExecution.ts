import {produce} from "immer"
import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import type {CancelTestsParams, TestExecutionResult} from "../types"

import {testRunStatesAtom, playgroundStateAtom, selectedVariantsAtom} from "./core"
import {pendingWebWorkerRequestsAtom} from "./webWorkerIntegration"

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

            // 1) Update legacy test run states (if used elsewhere)
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

            // 3) Clear running flags in playground state so UI updates immediately
            set(
                playgroundStateAtom,
                produce((draft) => {
                    if (!draft?.generationData) return draft
                    for (const vId of targetVariantIds) {
                        const isChatVariant = !!get(variantFlagsAtomFamily({revisionId: vId}))
                            ?.isChat

                        if (isChatVariant) {
                            const messageRows = draft.generationData.messages?.value || []
                            messageRows.forEach((messageRow: any) => {
                                if (rowId && messageRow.__id !== rowId) return
                                const history = messageRow.history?.value || []
                                if (history.length > 0) {
                                    const lastMessage = history[history.length - 1]
                                    if (lastMessage.__runs?.[vId]) {
                                        lastMessage.__runs[vId].__isRunning = undefined
                                    }
                                }
                            })
                        } else {
                            const inputRows = draft.generationData.inputs?.value || []
                            inputRows.forEach((inputRow: any) => {
                                if (rowId && inputRow.__id !== rowId) return
                                if (inputRow.__runs?.[vId]) {
                                    inputRow.__runs[vId].__isRunning = undefined
                                }
                            })
                        }
                    }

                    return draft
                }),
            )

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

// Rerun chat output mutation atom - fixed to properly handle chat reruns
export const rerunChatOutputMutationAtom = atom(
    null,
    (get, set, messageId: string, variantId?: string) => {
        try {
            const playgroundState = get(playgroundStateAtom)

            // Find the message row that contains this messageId
            const messageRows = playgroundState.generationData?.messages?.value || []
            const messageRow = messageRows?.find((row) =>
                row.history?.value?.some((historyItem) => {
                    return (
                        historyItem.__id === messageId ||
                        // Also match nested property ids (e.g., content id)
                        Boolean(findPropertyInObject(historyItem, messageId)) ||
                        (!!variantId &&
                            (historyItem.__runs?.[variantId]?.messages?.some(
                                (r) => r?.__id === messageId,
                            ) ||
                                historyItem.__runs?.[variantId]?.message?.__id === messageId))
                    )
                }),
            )

            if (!messageRow) {
                console.error("Message row not found for messageId:", messageId)
                return
            }

            // Step 1: Truncate conversation after the selected message
            set(playgroundStateAtom, (prev) =>
                produce(prev, (draft) => {
                    const targetMessageRow = draft.generationData?.messages?.value?.find((row) =>
                        row.history?.value?.some((historyItem) => {
                            // Direct user message match
                            if (historyItem.__id === messageId) return true

                            if (variantId) {
                                const run = historyItem.__runs?.[variantId]
                                return (
                                    run?.message?.__id === messageId ||
                                    (Array.isArray(run?.messages) &&
                                        run!.messages.some((r: any) => r?.__id === messageId))
                                )
                            }

                            const runs = historyItem.__runs || {}
                            return Object.values(runs).some((run: any) => {
                                return (
                                    run?.message?.__id === messageId ||
                                    (Array.isArray(run?.messages) &&
                                        run.messages.some((r: any) => r?.__id === messageId))
                                )
                            })
                        }),
                    )

                    if (targetMessageRow?.history?.value) {
                        const messageIndex = targetMessageRow.history.value.findIndex(
                            (historyItem) => {
                                // Direct user message match
                                if (historyItem.__id === messageId) return true

                                if (variantId) {
                                    const run = historyItem.__runs?.[variantId]
                                    return (
                                        run?.message?.__id === messageId ||
                                        (Array.isArray(run?.messages) &&
                                            run!.messages.some((r: any) => r?.__id === messageId))
                                    )
                                }

                                const runs = historyItem.__runs || {}
                                return Object.values(runs).some((run: any) => {
                                    return (
                                        run?.message?.__id === messageId ||
                                        (Array.isArray(run?.messages) &&
                                            run.messages.some((r: any) => r?.__id === messageId))
                                    )
                                })
                            },
                        )

                        if (messageIndex !== -1) {
                            // Truncate the conversation: remove all messages after the rerun point
                            // This includes both assistant responses AND empty user messages
                            targetMessageRow.history.value = targetMessageRow.history.value.slice(
                                0,
                                messageIndex + 1,
                            )

                            // Also clear any assistant responses for the selected message
                            const targetVariantIds = variantId
                                ? [variantId]
                                : get(selectedVariantsAtom)
                            const selectedMessage = targetMessageRow.history.value[messageIndex]

                            if (selectedMessage?.__runs) {
                                targetVariantIds.forEach((vId) => {
                                    if (selectedMessage.__runs?.[vId]) {
                                        // Clear the assistant response for rerun
                                        delete selectedMessage.__runs[vId]
                                    }
                                })
                            }

                            console.log(
                                "Truncated conversation after messageId:",
                                messageId,
                                "at index:",
                                messageIndex,
                            )
                        }
                    }
                }),
            )

            return messageRow
        } catch (error) {
            console.error("Error in rerunChatOutputMutationAtom:", error)
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

    // Also clear test results from generation data (UI display source)
    set(playgroundStateAtom, (prev) =>
        produce(prev, (draft) => {
            // Clear results from input rows
            if (draft.generationData.inputs?.value) {
                draft.generationData.inputs.value.forEach((row: any) => {
                    if (row.__runs) {
                        Object.keys(row.__runs).forEach((variantId) => {
                            if (!variantIds || variantIds.includes(variantId)) {
                                if (row.__runs[variantId]) {
                                    row.__runs[variantId].__result = null
                                }
                            }
                        })
                    }
                    // Also clear direct __result property
                    if (!variantIds) {
                        row.__result = null
                    }
                })
            }

            // Clear results from message rows (for chat variants)
            if (draft.generationData.messages?.value) {
                draft.generationData.messages.value.forEach((row: any) => {
                    if (row.__runs) {
                        Object.keys(row.__runs).forEach((variantId) => {
                            if (!variantIds || variantIds.includes(variantId)) {
                                if (row.__runs[variantId]) {
                                    row.__runs[variantId].__result = null
                                }
                            }
                        })
                    }
                    // Also clear direct __result property
                    if (!variantIds) {
                        row.__result = null
                    }
                })
            }
        }),
    )

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
