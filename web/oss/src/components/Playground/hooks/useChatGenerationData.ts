import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {playgroundStateAtom} from "@/oss/components/Playground/state/atoms"

/**
 * Simplified hook that uses a single source of truth for generation data
 * All components read from playgroundStateAtom.generationData
 * All mutations write to playgroundStateAtom.generationData
 */
export const useChatGenerationData = () => {
    const playgroundState = useAtomValue(playgroundStateAtom)

    return useMemo(() => {
        const generationData = playgroundState.generationData || {
            inputs: {value: [], __metadata: {}},
            messages: {value: [], __metadata: {}},
        }

        const inputRows = generationData.inputs?.value || []
        const messageRows = generationData.messages?.value || []

        // Calculate total history items
        const totalHistoryItems = messageRows.reduce(
            (total: number, row: any) => total + (row.history?.value?.length || 0),
            0,
        )

        return {
            inputRows,
            messageRows,
            selectedSource: "playgroundStateAtom",
            totalHistoryItems,
        }
    }, [playgroundState.generationData])
}
