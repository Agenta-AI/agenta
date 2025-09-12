import {atom} from "jotai"

import {inputRowIdsAtom as normInputRowIdsAtom} from "@/oss/state/generation/entities"

/**
 * Ensure we always have at least one inputs row when variables exist.
 * Reading this atom returns the current count; subscriptions are wired in generationMutations.ts
 */
export const ensureInitialInputRowAtom = atom((get) => {
    const rowIds = get(normInputRowIdsAtom)
    return rowIds.length
})
