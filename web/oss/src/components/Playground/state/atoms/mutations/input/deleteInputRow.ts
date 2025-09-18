import {atom} from "jotai"

import {inputRowIdsAtom} from "@/oss/state/generation/entities"

/**
 * Delete a generation input row (chat or completion mode)
 */
export const deleteGenerationInputRowMutationAtom = atom(null, (get, set, rowId: string) => {
    set(inputRowIdsAtom, (prev) => prev.filter((id) => id !== rowId))
})
