import {useMemo} from "react"

import {useAtom} from "jotai"

import {repetitionIndexAtomFamily} from "@/oss/state/newPlayground/generation/uiState"

interface UseRepetitionResultProps {
    rowId: string
    variantId: string
    result: any
}

export const useRepetitionResult = ({rowId, variantId, result}: UseRepetitionResultProps) => {
    const [repetitionIndex, setRepetitionIndex] = useAtom(
        useMemo(() => repetitionIndexAtomFamily(`${rowId}:${variantId}`), [rowId, variantId]),
    )

    const totalRepetitions = Array.isArray(result) ? result.length : result ? 1 : 0
    const safeIndex =
        repetitionIndex >= totalRepetitions ? Math.max(0, totalRepetitions - 1) : repetitionIndex

    const currentResult = useMemo(() => {
        if (Array.isArray(result) && totalRepetitions > 0) {
            return result[safeIndex]
        }
        return result
    }, [result, safeIndex, totalRepetitions])

    const repetitionProps = useMemo(
        () =>
            totalRepetitions > 1
                ? {
                      current: safeIndex + 1,
                      total: totalRepetitions,
                      onNext: () =>
                          setRepetitionIndex((prev) => Math.min(totalRepetitions - 1, prev + 1)),
                      onPrev: () => setRepetitionIndex((prev) => Math.max(0, prev - 1)),
                  }
                : undefined,
        [totalRepetitions, safeIndex, setRepetitionIndex],
    )

    return {
        currentResult,
        repetitionIndex: safeIndex,
        repetitionProps,
    }
}
