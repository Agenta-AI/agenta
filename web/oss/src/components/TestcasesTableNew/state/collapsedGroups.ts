import {atomWithStorage} from "jotai/utils"

/**
 * Persisted state for collapsed column groups in testcases table
 * Stored in localStorage so collapse state persists across sessions
 */
export const collapsedGroupsAtom = atomWithStorage<string[]>(
    "agenta:testcases:collapsed-groups",
    [],
)
