import {atom} from "jotai"

import {chatTurnsByIdAtom as normChatTurnsByIdAtom} from "@/oss/state/generation/entities"

/**
 * Atom-level guard to ensure chat mode always has at least one message row for input.
 * Reading this atom will return current turn count; subscriptions are wired in generationMutations.ts
 */
export const ensureInitialChatRowAtom = atom((get) => {
    const turns = get(normChatTurnsByIdAtom)
    return Object.keys(turns || {}).length
})
