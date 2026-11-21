import {atom} from "jotai"
import {atomFamily} from "jotai-family"

/**
 * The open quick action of a builder chat, by its id, per session id. In the app store, so it
 * survives a remount of the conversation (design D6). The builder panel reads and writes it.
 */
export const conversationQuickActionAtomFamily = atomFamily((_sessionId: string) =>
    atom<string | null>(null),
)
