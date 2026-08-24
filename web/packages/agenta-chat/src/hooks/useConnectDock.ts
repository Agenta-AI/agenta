/**
 * Headless state for the connect dock — the sibling of `useApprovalDock`, for parked
 * `request_connection` client tools instead of permission gates.
 *
 * A turn can park several connections at once, so the dock is a STACK: one card is in front and
 * owns the actions, the rest wait behind it and can be pulled forward. Two things this hook holds
 * that the render can't derive on its own:
 *
 *  - **which card is in front.** Pulling one forward is a user choice; it must survive re-renders
 *    and reset itself when that call settles and leaves the pending set.
 *  - **the batch total.** The pending set SHRINKS as each connection settles, so a naive
 *    "1 of {pending}" would count down instead of up. The total is latched on the way in and
 *    released only when the batch empties, which is what makes the counter read "2 of 3".
 */
import {useCallback, useMemo, useRef, useState} from "react"

import type {UIMessage} from "ai"

import {getPendingConnectInteractions} from "../clientTools/connectInteractions"
import type {ClientToolMeta} from "../skin"

export interface UseConnectDockArgs {
    messages: UIMessage[]
    /**
     * False suppresses the dock entirely (still streaming, or the user stopped the run — nothing
     * is really parked). Hosts pass their own gate; the pending set alone can't tell.
     */
    enabled?: boolean
}

export interface ConnectDockState {
    /** At least one connection is parked — the dock should be visible. */
    open: boolean
    /** Every parked connection, front card first (the user's pick, else the agent's order). */
    stack: ClientToolMeta[]
    /** The card that owns the actions; null when nothing is parked. */
    front: ClientToolMeta | null
    /** 1-based position of the front card in the batch (the "N" of "N of M"). */
    position: number
    /** How many connections the batch started with (the "M"). */
    total: number
    /** Pull a card behind the front one forward. */
    bringForward: (toolCallId: string) => void
}

export const useConnectDock = ({
    messages,
    enabled = true,
}: UseConnectDockArgs): ConnectDockState => {
    const pending = useMemo(
        () => (enabled ? getPendingConnectInteractions(messages) : []),
        [messages, enabled],
    )

    // The user's pick. Cleared implicitly: once that call settles it drops out of `pending`, so
    // the lookup below misses and the front falls back to the agent's first-asked.
    const [frontId, setFrontId] = useState<string | null>(null)

    const stack = useMemo(() => {
        const picked = frontId ? pending.find((meta) => meta.toolCallId === frontId) : undefined
        if (!picked) return pending
        return [picked, ...pending.filter((meta) => meta.toolCallId !== frontId)]
    }, [pending, frontId])

    // Latched batch size — see the counter note in the module doc. Released when the batch empties
    // so the next turn's connections start their own count.
    const totalRef = useRef(0)
    if (pending.length === 0) totalRef.current = 0
    else if (pending.length > totalRef.current) totalRef.current = pending.length
    const total = totalRef.current

    const bringForward = useCallback((toolCallId: string) => setFrontId(toolCallId), [])

    return {
        open: stack.length > 0,
        stack,
        front: stack[0] ?? null,
        position: total - stack.length + 1,
        total,
        bringForward,
    }
}
