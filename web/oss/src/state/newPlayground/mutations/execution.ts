import {atom} from "jotai"

// Use local bridge to decouple from legacy folder
import {cancelTestsMutationAtom} from "@/oss/components/Playground/state/atoms"

/**
 * Test Execution Atoms
 *
 * These atoms handle test execution via web worker integration.
 * Clean separation from config management with optimized execution flow.
 */

// Store pending web worker requests for tracking
export const pendingWebWorkerRequestsAtom = atom<
    Record<
        string,
        {
            rowId: string
            variantId: string
            runId: string
            timestamp: number
        }
    >
>({})

// Cancel specific test
export const cancelTestAtom = atom(null, (get, set, params: {rowId: string; variantId: string}) => {
    set(cancelTestsMutationAtom, params)
})
