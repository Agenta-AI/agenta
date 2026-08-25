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
 *  - **the batch.** The pending set SHRINKS as each connection settles and REORDERS when a card is
 *    pulled forward, so the progress dots read `batch` instead — every connect call on the turn,
 *    settled included, in the agent's order.
 */
import {useCallback, useMemo, useState} from "react"

import type {UIMessage} from "ai"

import {
    getConnectInteractions,
    getPendingConnectInteractions,
} from "../clientTools/connectInteractions"
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
    /** The whole turn's connect calls, settled included, in the agent's order — what the progress
     *  dots walk. Stable: it neither shrinks on a settle nor reorders when a card is pulled up. */
    batch: ClientToolMeta[]
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
    const batch = useMemo(
        () => (enabled ? getConnectInteractions(messages) : []),
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

    const bringForward = useCallback((toolCallId: string) => setFrontId(toolCallId), [])

    // Derived from the real batch now, so both hold through a settle without a latch: `batch` keeps
    // its settled entries, and the counter simply reads how many of them are done.
    const total = batch.length
    const settled = batch.filter((meta) => meta.settled).length

    return {
        open: stack.length > 0,
        stack,
        batch,
        front: stack[0] ?? null,
        position: settled + 1,
        total,
        bringForward,
    }
}
