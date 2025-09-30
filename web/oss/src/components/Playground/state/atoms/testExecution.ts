import {produce} from "immer"
import {atom} from "jotai"

import {runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {loadingByRowRevisionAtomFamily} from "@/oss/state/newPlayground/generation/runtime"
import {
    pendingWebWorkerRequestsAtom,
    ignoredWebWorkerRunIdsAtom,
} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import type {CancelTestsParams, TestExecutionResult} from "../types"

import {testRunStatesAtom, selectedVariantsAtom} from "./core"

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

                if (runIdsToCancel.length > 0) {
                    set(ignoredWebWorkerRunIdsAtom, (prev) => {
                        const next = {...prev}
                        runIdsToCancel.forEach((rid) => {
                            next[rid] = true
                        })
                        return next
                    })
                }

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
