/**
 * Wires the inline connect rows to the connect dock: wrap the transcript AND the dock in this, and
 * a still-parked "Connect to X below" row becomes a link that brings X's card to the front.
 *
 * It exists here, not in the widget's own package, because it is the only place that knows both
 * halves — `ConnectionDockState` is a @agenta/chat type and the widget lives one package below.
 * Hosts pass the same `connects` object they already pass to `ConnectionDock`; nothing else.
 */
import {useMemo, type ReactNode} from "react"

import {ConnectFocusContextProvider} from "@agenta/entity-ui/clientTools"

import type {ConnectionDockState} from "../hooks/useConnectionDock"

export interface ConnectionFocusProviderProps {
    connects: ConnectionDockState
    children: ReactNode
}

export const ConnectionFocusProvider = ({connects, children}: ConnectionFocusProviderProps) => {
    const {open, stack, bringForward} = connects
    // Only the cards the dock is actually showing are jump targets — `stack` is the pending set, so
    // it drops each call as it settles and the row falls back to plain text on its own.
    // Keyed on the ids rather than the array so the context value survives the dock's re-renders.
    const idKey = open ? stack.map((meta) => meta.toolCallId).join("|") : ""
    const value = useMemo(
        () => ({focus: bringForward, focusableIds: idKey ? idKey.split("|") : []}),
        [idKey, bringForward],
    )
    return <ConnectFocusContextProvider value={value}>{children}</ConnectFocusContextProvider>
}
