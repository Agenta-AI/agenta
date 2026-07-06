import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

/**
 * Persisted expand/collapse state for in-message widgets (thoughts, tool rows, long errors), keyed by
 * a STABLE id (message id + part, or tool call id). Lives outside the row components so it survives a
 * Virtuoso unmount/remount when a row scrolls out of the window — otherwise expanded thoughts/tools
 * would reset to collapsed on scroll-back. `undefined` = the widget follows its own default.
 */
export const agentChatExpandedAtomFamily = atomFamily((_key: string) =>
    atom<boolean | undefined>(undefined),
)
