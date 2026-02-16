import {useCallback, useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {useRepetitionResult} from "./useRepetitionResult"

interface UseExecutionCellParams {
    entityId: string
    stepId: string
    /** When true, returns empty defaults without subscribing to execution state */
    skip?: boolean
}

interface ResolvedResult {
    resultHash?: string | null
    isRunning?: boolean
    result?: unknown
    traceId?: string | null
}

/**
 * Single source of truth for execution cell data and actions.
 *
 * Replaces:
 * - useGenerationCompletionRow (for result/status data)
 * - Inline resolvedGenerationResult usage in GenerationChatTurnNormalized
 * - Manual generationResult + fullResultByRowEntity merging in comparison view
 *
 * @param entityId - The entity (revision) being executed
 * @param stepId - The test case row or chat turn being executed
 */
const noop = () => {}
const EMPTY_RESULT = {
    isRunning: false,
    result: null,
    currentResult: null,
    traceId: null,
    resultHash: null,
    repetitionIndex: 0,
    repetitionProps: undefined,
    run: noop,
    cancel: noop,
} as const

export function useExecutionCell({entityId, stepId, skip}: UseExecutionCellParams) {
    const resolved = useAtomValue(
        useMemo(
            () =>
                executionItemController.selectors.resolvedResult({
                    entityId: skip ? "" : entityId,
                    rowId: skip ? "" : stepId,
                }),
            [entityId, stepId, skip],
        ),
    ) as ResolvedResult | undefined

    const isRunning = skip ? false : Boolean(resolved?.isRunning)
    const result = skip ? null : (resolved?.result ?? null)
    const traceId = skip ? null : ((resolved?.traceId as string | null) ?? null)
    const resultHash = skip ? null : ((resolved?.resultHash as string | null) ?? null)

    const {currentResult, repetitionIndex, repetitionProps} = useRepetitionResult({
        rowId: stepId,
        entityId: entityId,
        result,
    })

    const triggerTest = useSetAtom(executionItemController.actions.triggerTest)
    const cancelTests = useSetAtom(executionItemController.actions.cancelTests)

    const run = useCallback(() => {
        if (skip) return
        triggerTest({executionId: entityId, step: {id: stepId}})
    }, [triggerTest, entityId, stepId, skip])

    const cancel = useCallback(() => {
        if (skip) return
        cancelTests({rowId: stepId, entityId: entityId})
    }, [cancelTests, stepId, entityId, skip])

    if (skip) return EMPTY_RESULT

    return {
        isRunning,
        result,
        currentResult,
        traceId,
        resultHash,
        repetitionIndex,
        repetitionProps,
        run,
        cancel,
    }
}
