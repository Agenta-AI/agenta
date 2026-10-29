import {useEffect, useRef, useState} from "react"

import {Chat} from "@ai-sdk/react"
import {type UIMessage} from "ai"

import {
    commitSessionChat,
    createSessionChat,
    peekSessionChat,
    releaseSessionChat,
    type SessionChatHooks,
} from "../state/sessionChats"

interface Provisional {
    sessionId: string
    handle: ReturnType<typeof createSessionChat>
}

/**
 * Bind this mount to the session's live `Chat`, creating one if the session has none yet.
 *
 * The claim is COMMIT-AWARE: render only ever creates a provisional instance and reads what is
 * already published; publishing happens in an effect. React can abandon a render, and a render that
 * published would leave the registry holding a chat seeded from `initialMessages` the user never
 * saw — the next committed mount would then reuse it and silently ignore its own seed. An abandoned
 * render's provisional chat is simply never published, and is garbage with the fiber.
 *
 * `shouldPreserve` is the host's verdict, read at unmount: the desktop asks "is its tab still open?",
 * mobile "is its run still streaming?".
 */
export const useSessionChat = ({
    sessionId,
    initialMessages,
    hooks,
    shouldPreserve,
}: {
    sessionId: string
    initialMessages: UIMessage[]
    hooks: SessionChatHooks
    shouldPreserve: () => boolean
}): Chat<UIMessage> => {
    // Created once per session id. A ref, not `useState`, because the instance must follow a
    // sessionId change on a mount React kept rather than remounted.
    const provisionalRef = useRef<Provisional | null>(null)
    if (provisionalRef.current?.sessionId !== sessionId) {
        provisionalRef.current = {
            sessionId,
            handle: createSessionChat({sessionId, initialMessages, hooks}),
        }
    }
    const provisional = provisionalRef.current.handle

    // Bumped only when another mount published first, to re-render onto the winner.
    const [, rebind] = useState(0)
    const chat = peekSessionChat(sessionId) ?? provisional.chat

    // Publish + rebind AFTER commit, not during render. No dep array — the callbacks close over
    // every render's values, so a preserved chat never runs the closures of a stale render.
    useEffect(() => {
        provisional.hooks = hooks
        const live = commitSessionChat(sessionId, provisional)
        if (live !== chat) rebind((n) => n + 1)
    })

    // Read at unmount, so the verdict reflects the state then rather than at bind time.
    const preserveRef = useRef(shouldPreserve)
    preserveRef.current = shouldPreserve

    useEffect(
        () => () => {
            releaseSessionChat(sessionId, provisionalRef.current!.handle, {
                preserve: preserveRef.current(),
            })
        },
        [sessionId],
    )

    return chat
}
