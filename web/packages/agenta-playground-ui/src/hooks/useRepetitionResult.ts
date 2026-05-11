import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {useAtomValue, useSetAtom} from "jotai"

interface UseRepetitionResultProps {
    rowId: string
    entityId: string
    result: unknown
}

export const useRepetitionResult = ({rowId, entityId, result}: UseRepetitionResultProps) => {
    const repetitionIndex = useAtomValue(
        useMemo(
            () => executionItemController.selectors.repetitionIndex({rowId, entityId}),
            [rowId, entityId],
        ),
    )
    const setRepetitionIndex = useSetAtom(executionItemController.actions.setRepetitionIndex)

    const resultArray = Array.isArray(result) ? result : null
    const totalRepetitions = resultArray ? resultArray.length : result ? 1 : 0
    const safeIndex =
        repetitionIndex >= totalRepetitions ? Math.max(0, totalRepetitions - 1) : repetitionIndex

    const currentResult = useMemo(() => {
        if (resultArray && totalRepetitions > 0) {
            return resultArray[safeIndex]
        }
        return result
    }, [result, resultArray, safeIndex, totalRepetitions])

    const repetitionProps = useMemo(
        () =>
            totalRepetitions > 1
                ? {
                      current: safeIndex + 1,
                      total: totalRepetitions,
                      onNext: () =>
                          setRepetitionIndex({
                              rowId,
                              entityId,
                              index: Math.min(totalRepetitions - 1, safeIndex + 1),
                          }),
                      onPrev: () =>
                          setRepetitionIndex({
                              rowId,
                              entityId,
                              index: Math.max(0, safeIndex - 1),
                          }),
                  }
                : undefined,
        [rowId, entityId, totalRepetitions, safeIndex, setRepetitionIndex],
    )

    return {
        currentResult,
        repetitionIndex: safeIndex,
        repetitionProps,
    }
}
