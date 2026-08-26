import {useEffect, useRef, type RefObject} from "react"

import {chatPanelMaximizedAtom} from "@agenta/chat/state"
import {useAtomValue, useSetAtom} from "jotai"

import {useChatScopeKey} from "../state/scope"
import {sessionSearchRequestAtom} from "../state/uiRequests"

/**
 * Puts the caret in the rail's search box when the panel asks for it (Alt+F).
 *
 * Mirrors `useInlineRenameRequest`: the drawer's panel and the playground's are mounted together,
 * each with its own rail, so the request is scoped — and the nonce is claimed BEFORE the on-screen
 * check, so toggling maximize later cannot replay a stale one.
 */
export function useSessionSearchRequest(inputRef: RefObject<HTMLInputElement | null>) {
    const scope = useChatScopeKey()
    const request = useAtomValue(sessionSearchRequestAtom)
    const maximized = useAtomValue(chatPanelMaximizedAtom)
    const setMaximized = useSetAtom(chatPanelMaximizedAtom)
    const consumedNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (request?.scope !== scope) return
        if (consumedNonceRef.current === request.nonce) return
        // The rail is a 0-width, inert pane until the panel is maximized, so asking to search it
        // has to open it first — otherwise the chord looks broken in the default layout. The
        // nonce stays unclaimed here on purpose: this effect re-runs once `maximized` flips, and
        // that pass is the one that focuses.
        if (!maximized) {
            setMaximized(true)
            return
        }
        consumedNonceRef.current = request.nonce
        inputRef.current?.focus()
        inputRef.current?.select()
    }, [request, scope, maximized, setMaximized, inputRef])
}
