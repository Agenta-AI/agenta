import {useEffect, useRef, type RefObject} from "react"

import {useAtomValue} from "jotai"

import type {SessionTabLabelHandle} from "../components/SessionTabLabel"
import {chatPanelMaximizedAtom} from "../state/panelLayout"
import {useChatScopeKey} from "../state/scope"
import {matchesSessionRequest, renameSessionRequestAtom} from "../state/uiRequests"

/**
 * Opens this row's inline rename editor when the panel asks for it (Alt+R).
 *
 * Both session surfaces stay mounted — the rail is latched after its first open — so the two rows
 * for one session would race their `autoFocus` inputs. Only the surface that is actually on screen
 * acts. The nonce is claimed BEFORE that check, deliberately: the hidden surface consumes the
 * request too, so toggling maximize later can't reopen a stale one.
 */
export function useInlineRenameRequest(
    sessionId: string,
    labelRef: RefObject<SessionTabLabelHandle | null>,
    surface: "strip" | "rail",
) {
    const scope = useChatScopeKey()
    const request = useAtomValue(renameSessionRequestAtom)
    const maximized = useAtomValue(chatPanelMaximizedAtom)
    const consumedNonceRef = useRef<number | null>(null)
    useEffect(() => {
        if (!matchesSessionRequest(request, scope, sessionId)) return
        if (consumedNonceRef.current === request.nonce) return
        consumedNonceRef.current = request.nonce
        if ((surface === "rail") !== maximized) return
        labelRef.current?.startEditing()
    }, [request, scope, sessionId, surface, maximized, labelRef])
}
