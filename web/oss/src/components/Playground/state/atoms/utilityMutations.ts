import {current, produce} from "immer"
import {atom} from "jotai"

import {createMessageFromSchema} from "@/oss/components/Playground/hooks/usePlayground/assets/messageHelpers"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {fetchTestset} from "@/oss/services/testsets/api"
import {
    runStatusByRowRevisionAtom,
    inputRowsByIdAtom,
    inputRowIdsAtom,
    chatTurnsByIdAtom,
    chatSessionsByIdAtom,
    chatSessionIdsAtom,
    logicalTurnIndexAtom,
    rowIdIndexAtom,
    chatTurnsByIdFamilyAtom,
    chatTurnIdsAtom,
} from "@/oss/state/generation/entities"
import {appUriInfoAtom, getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

import {appChatModeAtom} from "./app"
import {generationRowIdsAtom} from "./generationProperties"
import {displayedVariantsVariablesAtom, displayedVariantsAtom} from "./variants"

/**
 * Utility mutations for playground operations
 * These were extracted from the original enhancedVariantMutations.ts file
 */

// Clear all runs mutation
export const clearAllRunsMutationAtom = atom(null, (get, set, variantIds?: string[] | any) => {
    // Handle case where UI passes event object instead of proper parameters
    const actualVariantIds = Array.isArray(variantIds) ? variantIds : undefined
    const isChat = get(appChatModeAtom)
    const selectedRowIds = (get(generationRowIdsAtom) || []) as string[]
    const selectedSet = new Set(selectedRowIds)

    // Only reset run status for currently visible rowIds (logical for chat, input for completion)
    set(runStatusByRowRevisionAtom, (prev) => {
        const next: Record<string, {isRunning?: string | false; resultHash?: string | null}> = {}
        for (const [key, val] of Object.entries(prev || {})) {
            const [rowId, revId] = key.split(":")
            const matchesRow = selectedSet.has(rowId)
            const matchesVariant = !actualVariantIds || actualVariantIds.includes(revId)
            if (matchesRow && matchesVariant) next[key] = {isRunning: false, resultHash: null}
            else next[key] = val
        }
        return next
    })

    // Normalized: clear completion responses per revision
    set(inputRowsByIdAtom, (prev) =>
        produce(prev, (draft: any) => {
            Object.entries(draft || {}).forEach(([rowId, row]: any) => {
                if (!row || !row.responsesByRevision) return
                if (!selectedSet.has(rowId)) return
                if (actualVariantIds && actualVariantIds.length > 0) {
                    actualVariantIds.forEach((revId) => {
                        if (row.responsesByRevision[revId]) row.responsesByRevision[revId] = []
                    })
                } else {
                    Object.keys(row.responsesByRevision).forEach((revId) => {
                        row.responsesByRevision[revId] = []
                    })
                }
            })
        }),
    )

    if (isChat) {
        // For chat apps: remove all turns in the current view
        set(chatTurnIdsAtom, [])
    }
})
