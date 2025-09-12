import {atom} from "jotai"

import {logicalTurnIndexAtom as normLogicalTurnIndexAtom} from "@/oss/state/generation/entities"

import {displayedVariantsAtom} from "../../variants"

/**
 * Prune logicalTurnIndex mappings for revisions no longer displayed.
 * Prevents stale per-variant mappings from causing updates/appends to removed revisions.
 */
export const pruneLogicalTurnIndexForDisplayedVariantsMutationAtom = atom(null, (get, set) => {
    const displayedRevIds = new Set((get(displayedVariantsAtom) || []) as string[])
    const index = (get(normLogicalTurnIndexAtom) || {}) as Record<string, Record<string, string>>
    const next: Record<string, Record<string, string>> = {}
    let changed = false
    Object.entries(index).forEach(([logicalId, map]) => {
        const filtered: Record<string, string> = {}
        Object.entries(map || {}).forEach(([revId, sid]) => {
            if (displayedRevIds.has(revId)) filtered[revId] = sid
            else changed = true
        })
        next[logicalId] = filtered
    })
    if (changed) {
        set(normLogicalTurnIndexAtom, next as any)
    }
})
