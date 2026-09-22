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
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {declinedConnectOutput} from "@agenta/shared/clientTools"
import type {UIMessage} from "ai"

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import {
    getConnectInteractions,
    getPendingConnectInteractions,
} from "../clientTools/connectInteractions"
import type {ClientToolMeta} from "../skin"

export interface UseConnectionDockArgs {
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
    /**
     * A question form is parked. Same reason as `approvalsPending`, one rung down: the question dock
     * is a TYPING surface, so its digits and arrows would otherwise leak into a connect card that
     * binds neither. Precedence is approval > elicitation > connect, and the composer dock renders
     * them in that order so visual and keyboard order never disagree.
     */
    elicitationPending?: boolean
    /** Settle channel for the host-driven `dismiss`. Without it, `dismiss` is a no-op. */
    onOutput?: ClientToolOutputHandler
}

export interface ConnectionDockState {
    /** At least one connection is parked — the dock should be visible. */
    open: boolean
    /** Every parked connection, front card first (the user's pick, else the agent's order). */
    stack: ClientToolMeta[]
    /** The connections parked in this group, settled ones included, in the agent's order — what
     *  the progress dots walk. Stable: it neither shrinks on a settle nor reorders on a pick. */
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
    /**
     * Settle every parked connection as its card's "Not now" would, from outside the cards. The
     * host calls this when the user sends a chat message over the dock: the message is the answer,
     * so the requests go and the message follows them in. Mirrors `ElicitationDockState.dismiss`:
     * resolves once every settle write lands; rejects (and re-opens the dock) when one fails,
     * whether the handler threw or reported `false`. A no-op while nothing is parked.
     */
    dismiss: () => Promise<void>
    /**
     * The settle channel the cards answer through — the host's `onOutput` wrapped so a card leaves
     * when its answer LEAVES rather than when the transcript carries it back, and comes back when
     * the write did not land. Hosts pass this to the dock component, not their own handler.
     */
    settle: ClientToolOutputHandler
    /**
     * Calls answered here whose transcript rows have not arrived. Empty again once they do, or once
     * a write fails — a host reads it as "an answer is in flight", which is not the same as parked.
     */
    settlingIds: ReadonlySet<string>
}

export const useConnectionDock = ({
    messages,
    enabled = true,
    approvalsPending = false,
    elicitationPending = false,
    onOutput,
}: UseConnectionDockArgs): ConnectionDockState => {
    const pending = useMemo(
        () => (enabled ? getPendingConnectInteractions(messages) : []),
        [messages, enabled],
    )
    const turnConnections = useMemo(
        () => (enabled ? getConnectInteractions(messages) : []),
        [messages, enabled],
    )

    // The dots walk the connections parked in THIS group, not every connect call the turn ever
    // made. A long turn accumulates them — the agent's own retries of one tool included — and
    // reading the whole turn showed a row of dots for a single outstanding connection.
    //
    // The group opens with whatever is pending when the dock does, and holds those ids as each one
    // settles so they stay on the row as progress. It empties with the dock, so the agent's next
    // ask starts a fresh group.
    const groupIdsRef = useRef<string[]>([])
    if (pending.length === 0) groupIdsRef.current = []
    else {
        const known = new Set(groupIdsRef.current)
        const added = pending.filter((meta) => !known.has(meta.toolCallId))
        if (added.length)
            groupIdsRef.current = [...groupIdsRef.current, ...added.map((m) => m.toolCallId)]
    }
    const batch = useMemo(() => {
        const byId = new Map(turnConnections.map((meta) => [meta.toolCallId, meta]))
        return groupIdsRef.current
            .map((id) => byId.get(id))
            .filter((meta): meta is ClientToolMeta => !!meta)
    }, [turnConnections, pending])

    // The user's pick. Cleared implicitly: once that call settles it drops out of `pending`, so
    // the lookup below misses and the front falls back to the agent's first-asked.
    const [frontId, setFrontId] = useState<string | null>(null)

    // Calls whose answer is out but whose transcript row has not come back. Keyed rather than a
    // bare flag so it survives the dock's closing animation (`shown` still holds the settled
    // calls) and cannot leak onto the agent's next ask.
    const [settlingIds, setSettlingIds] = useState<ReadonlySet<string>>(() => new Set())
    const settlingRef = useRef<Set<string>>(new Set())
    const markSettling = useCallback((ids: string[]) => {
        for (const id of ids) settlingRef.current.add(id)
        setSettlingIds(new Set(settlingRef.current))
    }, [])
    const forgetSettling = useCallback((ids: string[]) => {
        for (const id of ids) settlingRef.current.delete(id)
        setSettlingIds(new Set(settlingRef.current))
    }, [])

    // The transcript caught up, so the marker has nothing left to hide — and without this the set
    // would grow for the life of the conversation and keep reading as an answer in flight.
    useEffect(() => {
        if (settlingRef.current.size === 0) return
        const live = new Set(pending.map((meta) => meta.toolCallId))
        let changed = false
        for (const id of settlingRef.current) {
            if (!live.has(id)) {
                settlingRef.current.delete(id)
                changed = true
            }
        }
        if (changed) setSettlingIds(new Set(settlingRef.current))
    }, [pending])

    // A card whose answer is already out steps aside at once, so the next one comes forward
    // without waiting for the transcript to confirm the one behind it.
    const stack = useMemo(() => {
        const live = pending.filter((meta) => !settlingIds.has(meta.toolCallId))
        const picked = frontId ? live.find((meta) => meta.toolCallId === frontId) : undefined
        if (!picked) return live
        return [picked, ...live.filter((meta) => meta.toolCallId !== frontId)]
    }, [pending, frontId, settlingIds])

    const bringForward = useCallback((toolCallId: string) => setFrontId(toolCallId), [])

    // `pending` through a ref: the host calls `dismiss` from a send handler whose closure may
    // predate the current transcript.
    const pendingRef = useRef(pending)
    pendingRef.current = pending

    // A card answered itself. The write still has to reach the server and come back through the
    // records, so drop the card on the way out and give it back only if it never landed.
    const settle = useCallback<ClientToolOutputHandler>(
        async (args) => {
            if (!onOutput) return false
            markSettling([args.toolCallId])
            try {
                const landed = await onOutput(args)
                if (landed === false) forgetSettling([args.toolCallId])
                return landed
            } catch (error) {
                forgetSettling([args.toolCallId])
                throw error
            }
        },
        [onOutput, markSettling, forgetSettling],
    )

    const dismiss = useCallback(async () => {
        // No settle channel means nothing can be written, so nothing is dismissed — the documented
        // no-op. Checked before the markers go up, which would otherwise close the dock over
        // requests that are still parked.
        if (!onOutput) return
        const targets = pendingRef.current.filter(
            (meta) => !meta.settled && !settlingRef.current.has(meta.toolCallId),
        )
        if (targets.length === 0) return
        markSettling(targets.map((meta) => meta.toolCallId))
        try {
            const landed = await Promise.all(
                targets.map((meta) =>
                    onOutput?.({
                        toolName: meta.toolName,
                        toolCallId: meta.toolCallId,
                        output: declinedConnectOutput(meta.input) as Record<string, unknown>,
                    }),
                ),
            )
            if (landed.some((result) => result === false))
                throw new Error("The connection request couldn't be dismissed.")
        } catch (error) {
            // The requests are still live: give the dock back.
            forgetSettling(targets.map((meta) => meta.toolCallId))
            throw error
        }
    }, [onOutput, markSettling, forgetSettling])

    // Derived from the group: it keeps its settled entries, so the counter simply reads how many
    // are done rather than watching the pending set shrink.
    const total = batch.length
    const settled = batch.filter((meta) => meta.settled || settlingIds.has(meta.toolCallId)).length
    // An answered or dismissed stack closes the dock at once: what replaced it is the thing to
    // look at, and the cards only return if a write fails.
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
        shortcutsEnabled: !approvalsPending && !elicitationPending,
        dismiss,
        settle,
        settlingIds,
    }
}
