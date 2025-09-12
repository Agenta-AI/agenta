import {atom} from "jotai"

import {displayedVariantsAtom} from "../../variants"

/**
 * Dynamic Variables Sync (non-custom apps)
 * Keep normalized variables in sync with variables derived from prompts.
 * Base atom used as a watcher trigger; onMount subscriptions are wired in generationMutations.ts
 */
export const syncPromptVariablesToNormalizedAtom = atom((get) => {
    // Use displayed variants simply as a trigger; pruning is per-revision
    const ids = get(displayedVariantsAtom)
    return ids.length
})
