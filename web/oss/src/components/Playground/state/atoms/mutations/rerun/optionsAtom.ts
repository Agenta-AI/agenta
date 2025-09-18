import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

export interface Options {
    noAppend?: boolean
}

/**
 * Per-id options store.
 * - Each id (e.g., logicalId) maps to its own Options atom (default: {}).
 * - You can set by replacement or by merging via an updater function.
 */
export const optionsAtom = atomFamily((id: string) => {
    // Guard against accidental falsy keys so consumers don't crash.
    if (!id) {
        // Return an inert read-only atom when id is falsy.
        return atom<Options>({})
    }

    const base = atom<Options>({})
    ;(base as any).debugLabel = `options:${id}`
    return base
})
