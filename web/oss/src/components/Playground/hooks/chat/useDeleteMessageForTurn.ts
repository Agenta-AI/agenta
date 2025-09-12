import {useCallback} from "react"

import {produce} from "immer"

export interface DeleteArgs {
    resolvedTurnId: string
    variantId?: string
    displayedVariantIds?: string[]
    setTurns: (updater: any) => void
    setRunStatus: (updater: any) => void
    deleteTurn: (turnId: string) => void
    turnsById: Record<string, any>
    sessionsById: Record<string, any>
}

export const useDeleteMessageForTurn = ({
    resolvedTurnId,
    variantId,
    displayedVariantIds,
    setTurns,
    setRunStatus,
    deleteTurn,
    turnsById,
    sessionsById,
}: DeleteArgs) => {
    const onDeleteRow = useCallback(() => {
        const sid = (turnsById as any)?.[resolvedTurnId]?.sessionId
        const count = sid ? (sessionsById as any)?.[sid]?.turnIds?.length || 0 : 0
        if (count > 1) {
            deleteTurn(resolvedTurnId)
            return
        }

        setTurns((prev: any) =>
            produce(prev, (draft: any) => {
                if (!draft[resolvedTurnId]) return
                if (!draft[resolvedTurnId].userMessage)
                    draft[resolvedTurnId].userMessage = {content: {value: ""}}
                if (!draft[resolvedTurnId].userMessage.content)
                    draft[resolvedTurnId].userMessage.content = {value: ""}

                const u = draft[resolvedTurnId].userMessage
                if (Array.isArray(u.content?.value)) u.content.value = []
                else u.content.value = ""

                const a = draft[resolvedTurnId].assistantMessage
                if (a && a.content) {
                    if (Array.isArray(a.content.value)) a.content.value = []
                    else a.content.value = ""
                }
                if (draft[resolvedTurnId].assistantMessageByRevision) {
                    const map = draft[resolvedTurnId].assistantMessageByRevision
                    Object.keys(map || {}).forEach((rev) => {
                        if (map[rev]?.content) {
                            if (Array.isArray(map[rev].content.value)) map[rev].content.value = []
                            else map[rev].content.value = ""
                        }
                    })
                }
            }),
        )

        setRunStatus((prev: any) => {
            const next = {...(prev || {})}
            const vids = variantId ? [variantId] : displayedVariantIds || []
            vids.forEach((vid: string) => {
                const key = `${resolvedTurnId}:${vid}`
                if (key in next) delete next[key]
            })
            return next
        })
    }, [
        resolvedTurnId,
        variantId,
        displayedVariantIds,
        setTurns,
        setRunStatus,
        deleteTurn,
        turnsById,
        sessionsById,
    ])

    return {onDeleteRow}
}

export default useDeleteMessageForTurn
