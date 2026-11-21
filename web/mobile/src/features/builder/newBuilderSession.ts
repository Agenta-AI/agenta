import {markSessionFresh} from "@agenta/chat/state"

import {newId} from "@/lib/ids"

/** A new builder chat: a client-side id that becomes a server session on its first message. */
export const newBuilderSessionId = () => {
    const id = newId()
    // Never run: the conversation must not read its empty history as a pruned one.
    markSessionFresh(id)
    return id
}
