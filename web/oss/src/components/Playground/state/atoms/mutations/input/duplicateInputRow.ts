import {generateId} from "@agenta/shared/utils"
import {atom} from "jotai"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms/app"
import {displayedVariantsAtom} from "@/oss/components/Playground/state/atoms/variants"
import {
    inputRowIdsAtom,
    inputRowsByIdFamilyAtom,
    rowIdIndexAtom,
} from "@/oss/state/generation/entities"

/**
 * Duplicate a generation input row (completion mode only)
 * - Creates a new row with a fresh id and copies variable values by name
 * - Chat mode has a single shared row; duplication is a no-op
 */
export const duplicateGenerationInputRowMutationAtom = atom(
    null,
    (get, set, sourceRowId: string) => {
        const isChat = get(appChatModeAtom)
        if (isChat) {
            console.warn("duplicateGenerationInputRow: no-op in chat mode")
            return
        }

        const source = get(inputRowsByIdFamilyAtom(sourceRowId)) as any
        if (!source) return

        const newRowId = `row-${generateId()}`
        const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
        const baseline = displayedRevIds?.[0]

        // Prepare a map of values by variable name from source
        const valuesByName: Record<string, string> = {}
        for (const n of (source.variables || []) as any[]) {
            const name = (n?.key ?? n?.__id) as string | undefined
            if (!name) continue
            const v = n?.content?.value ?? n?.value
            valuesByName[name] = v !== undefined && v !== null ? String(v) : ""
        }

        // Ensure latestRevisionId for synthesis
        set(rowIdIndexAtom, (prev) => ({...(prev || {}), [newRowId]: {latestRevisionId: baseline}}))

        // Initialize the new row via family atom and copy values by name
        set(inputRowsByIdFamilyAtom(newRowId), (draft: any) => {
            if (!draft) return
            if (!Array.isArray(draft.variables)) draft.variables = []
            const byName = new Map<string, any>()
            for (const n of draft.variables) {
                const k = (n as any)?.key ?? (n as any)?.__id
                if (typeof k === "string" && k) byName.set(k, n)
            }
            for (const [k, v] of Object.entries(valuesByName)) {
                const node = byName.get(k)
                if (!node) continue
                if (node.content && typeof node.content === "object") node.content.value = v
                ;(node as any).value = v
            }
        })

        // Append the new row id
        set(inputRowIdsAtom, (prev) => [...(prev || []), newRowId])
    },
)
