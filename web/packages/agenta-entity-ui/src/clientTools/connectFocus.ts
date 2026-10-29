/**
 * "Answer this one" — the seam between an inline connect row and the connect dock.
 *
 * The dock's `bringForward` lives in @agenta/chat, one package ABOVE these widgets, so a row can't
 * reach it by import (that would close a workspace cycle). This context carries that one callback
 * down, together with the calls the dock is actually holding.
 *
 * A row is a link ONLY while its call is still parked and the dock has it. Connected, failed,
 * declined and deferred rows stay plain text: the card they'd jump to no longer exists.
 */
import {createContext, useContext, useMemo} from "react"

export interface ConnectFocusValue {
    /** Bring the card for this call to the front of the dock's stack. */
    focus: (toolCallId: string) => void
    /** The calls the dock currently holds. Anything else is not focusable. */
    focusableIds: readonly string[]
}

const ConnectFocusContext = createContext<ConnectFocusValue | null>(null)

export const ConnectFocusContextProvider = ConnectFocusContext.Provider

/**
 * The row's jump handler, or null when there is nothing to jump to — no dock mounted (transcript
 * replay, the session inspector), the dock is closed, or this call already settled.
 */
export const useConnectFocus = (toolCallId: string): (() => void) | null => {
    const ctx = useContext(ConnectFocusContext)
    const focus = ctx?.focus
    const focusable = !!ctx?.focusableIds.includes(toolCallId)
    return useMemo(
        () => (focusable && focus ? () => focus(toolCallId) : null),
        [focusable, focus, toolCallId],
    )
}
