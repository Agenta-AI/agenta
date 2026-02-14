import {useCallback, useMemo} from "react"

import {executionController, executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

import {useExecutionCell} from "../../../../../hooks/useExecutionCell"

const noop = () => {}

interface UseExecutionRowParams {
    entityId?: string
    rowId: string
    /** When true, skips execution cell data (result, running state, etc.) */
    inputOnly?: boolean
}

export function useExecutionRow({entityId, rowId, inputOnly}: UseExecutionRowParams) {
    const isChat = useAtomValue(executionController.selectors.isChatMode) ?? false
    const isComparisonView = useAtomValue(executionController.selectors.isCompareModeWithContext)
    const viewType: "single" | "comparison" = isComparisonView ? "comparison" : "single"

    // Skip heavy execution cell data when only rendering variable inputs
    const cell = useExecutionCell({
        entityId: entityId || "",
        stepId: rowId,
        skip: inputOnly,
    })

    // In chat mode, suppress completion result
    const isRunning = !isChat && !inputOnly ? cell.isRunning : false
    const result = !isChat && !inputOnly ? cell.result : undefined
    const resultHash = !isChat && !inputOnly ? (cell.resultHash ?? null) : null
    const traceId = !isChat && !inputOnly ? (cell.traceId ?? null) : null

    const isBusy = useAtomValue(
        useMemo(
            () =>
                isChat || inputOnly
                    ? executionItemController.selectors.isBusyForRow({rowId: "", entityId: ""})
                    : executionItemController.selectors.isBusyForRow({rowId, entityId}),
            [isChat, inputOnly, rowId, entityId],
        ),
    )
    const effectiveBusy = isChat || inputOnly ? false : isBusy

    const runRowAction = useSetAtom(executionItemController.actions.runRow)
    const cancelRowAction = useSetAtom(executionItemController.actions.cancelRow)

    const runRow = useCallback(() => {
        if (inputOnly) return
        runRowAction({rowId, entityId})
    }, [runRowAction, rowId, entityId, inputOnly])

    const cancelRow = useCallback(() => {
        if (inputOnly) return
        cancelRowAction({rowId, entityId})
    }, [cancelRowAction, rowId, entityId, inputOnly])

    return {
        isChat,
        viewType,
        isBusy: effectiveBusy,
        isRunning,
        result,
        resultHash,
        traceId,
        runRow: inputOnly ? noop : runRow,
        cancelRow: inputOnly ? noop : cancelRow,
    }
}
