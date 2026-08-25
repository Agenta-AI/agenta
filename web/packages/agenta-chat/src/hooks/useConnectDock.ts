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
import {useCallback, useMemo, useRef, useState} from "react"

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
    /**
     * An approval gate is pending. Approvals win: they bind the same Cmd/Ctrl+Enter and Escape, and
     * both docks can be open on one turn, so this parks the connect shortcuts rather than letting
     * one key fire two decisions. The rule lives here so neither host has to re-derive it.
     */
    approvalsPending?: boolean
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
    /** Whether the dock may bind its keyboard shortcuts (see `approvalsPending`). */
    shortcutsEnabled: boolean
}

export const useConnectDock = ({
    messages,
    enabled = true,
    approvalsPending = false,
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

    // Derived from the real batch: it keeps its settled entries, so the counter simply reads how
    // many are done rather than watching the pending set shrink.
    const total = batch.length
    const settled = batch.filter((meta) => meta.settled).length
    const open = stack.length > 0

    // Hold the last non-empty view so a host can animate the dock closed around content that is
    // already gone. It lives here rather than as a `useRef` copy-pasted into each host.
    const shownRef = useRef({stack, batch, position: 1, total})
    if (open) shownRef.current = {stack, batch, position: settled + 1, total}
    const shown = shownRef.current

    return {
        open,
        stack: shown.stack,
        batch: shown.batch,
        front: shown.stack[0] ?? null,
        position: shown.position,
        total: shown.total,
        bringForward,
        shortcutsEnabled: !approvalsPending,
    }
}
