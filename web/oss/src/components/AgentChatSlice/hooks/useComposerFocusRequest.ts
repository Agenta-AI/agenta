import {useEffect, useRef, type RefObject} from "react"

import {type RichChatInputHandle} from "@agenta/ui/rich-chat-input"
import {useAtomValue} from "jotai"

import {useChatScopeKey} from "../state/scope"
import {focusComposerRequestAtom, matchesSessionRequest} from "../state/uiRequests"

/**
 * Puts the caret in this session's composer when the panel asks for it (Alt+1…9).
 *
 * The frame — not the effect body — marks the request consumed. antd mounts a never-visited pane
 * only on activation, so this runs on that mount, and StrictMode replays it; claiming the nonce up
 * front would leave the replay with nothing to do and the caret nowhere.
 */
export function useComposerFocusRequest(
    sessionId: string,
    richInputRef: RefObject<RichChatInputHandle | null>,
) {
    const scope = useChatScopeKey()
    const request = useAtomValue(focusComposerRequestAtom)
    const consumedNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!matchesSessionRequest(request, scope, sessionId)) return
        const {nonce} = request
        if (consumedNonceRef.current === nonce) return
        requestAnimationFrame(() => {
            if (consumedNonceRef.current === nonce) return
            consumedNonceRef.current = nonce
            richInputRef.current?.focus()
        })
    }, [request, scope, sessionId, richInputRef])
}
