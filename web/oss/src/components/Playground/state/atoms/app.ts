import {selectAtom} from "jotai/utils"

import {playgroundIsChatModeAtom} from "./playgroundAppAtoms"

/**
 * App-level chat mode detection (pure selector)
 * Derived from isChatVariantAtomFamily on the first server revision.
 */
export const appChatModeAtom = selectAtom(
    playgroundIsChatModeAtom,
    (isChat) => isChat,
    (a, b) => a === b,
)

/**
 * App-level type derived from chat mode.
 * Expand this if we later support a distinct "custom" app type.
 */
export type AppType = "chat" | "completion"

export const appTypeAtom = selectAtom(
    appChatModeAtom,
    (isChat): AppType => (isChat === undefined ? undefined : isChat ? "chat" : "completion"),
    (a, b) => a === b,
)
