/**
 * Headless state for the question dock — which parked `request_input` call the card is answering.
 *
 * A trimmed `useConnectionDock`. Deliberately WITHOUT its group latch, batch, position/total and
 * `bringForward`: all of that exists to drive the connect dock's per-card progress dots across a
 * shingle stack, and the runner parks exactly ONE interaction per turn (a second is force-settled
 * `DEFERRED_NOT_EXECUTED` and re-asked — see `ConnectToolWidget`). Copying it would reintroduce
 * through the latches the very machinery the docked card rejects the shingle stack for.
 *
 * What IS kept from that hook is the closing latch, which is load-bearing: without it the card's
 * content vanishes the instant the call settles, and the host animates a collapse around an empty box.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    buildCancelResult,
    buildDegradationErrorText,
    parseElicitationPayload,
} from "@agenta/shared/utils"
import type {UIMessage} from "ai"

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import {
    getPendingElicitationInteractions,
    hasEarlierElicitationDegradation,
} from "../clientTools/elicitationInteractions"
import type {ClientToolMeta} from "../skin"

import {discardElicitationDraft} from "./useElicitationStepper"

export interface UseElicitationDockArgs {
    messages: UIMessage[]
    /**
     * False suppresses the dock entirely (still streaming, or the user stopped the run — nothing is
     * really parked). Hosts pass their own gate; the pending set alone can't tell.
     */
    enabled?: boolean
    /**
     * An approval gate is pending. Approvals win: they bind the same Cmd/Ctrl+Enter and Escape, and
     * both docks can be open on one turn, so this parks the question shortcuts rather than letting
     * one key fire two decisions. Mirrors `useConnectionDock`.
     */
    approvalsPending?: boolean
    /** Settle channel. Also how a payload we cannot render reports itself. */
    onOutput?: ClientToolOutputHandler
}

export interface ElicitationDockState {
    /** A question form is parked — the dock should be visible. */
    open: boolean
    /** The card that owns the actions; null when nothing is parked. */
    front: ClientToolMeta | null
    /** Everything parked, front first. Second and later simply wait — see the note above. */
    queue: ClientToolMeta[]
    /** Whether the dock may bind its keyboard shortcuts (see `approvalsPending`). */
    shortcutsEnabled: boolean
    /**
     * Settle every parked question as its card's ✕ would — a cancel, saved answers dropped —
     * from outside the cards. The host calls this when the user sends a chat message over the
     * dock: the message is the better answer, so the forms go and the message follows them in.
     * Every parked call, not just the front: the dock closes on dismiss, and a straggler left
     * unsettled would block the run behind a card nobody can see. Resolves once the writes land;
     * rejects (and re-opens the dock) when one fails, whether the handler threw or reported
     * `false`. A no-op while nothing is parked.
     */
    dismiss: () => Promise<void>
    /**
     * The settle channel the cards answer through — the host's `onOutput` wrapped so the dock
     * closes when the answer LEAVES rather than when the transcript carries it back, and re-opens
     * when the write did not land. Hosts pass this to the dock component, not their own handler.
     */
    settle: ClientToolOutputHandler
    /**
     * Calls answered here whose transcript rows have not arrived. Empty again once they do, or once
     * a write fails — a host reads it as "an answer is in flight", which is not the same as parked.
     */
    settlingIds: ReadonlySet<string>
}

/** Fully arrived. `input-streaming` and the `{}` input-refresh announce (sdk `vercel/stream.py`)
 * both parse as garbage but are not degradations — settling either kills a working request. */
const payloadArrived = (meta: ClientToolMeta): boolean => {
    if (meta.state !== "input-available") return false
    // The `{}` input-refresh announce (stream.py) is the one shape still worth waiting on. A
    // string, array or null is malformed and will never improve, so let it settle rather than
    // parking the run behind a Skip the user has to find.
    if (typeof meta.input === "object" && meta.input !== null && !Array.isArray(meta.input))
        return Object.keys(meta.input as Record<string, unknown>).length > 0
    return meta.input !== undefined
}

export const useElicitationDock = ({
    messages,
    enabled = true,
    approvalsPending = false,
    onOutput,
}: UseElicitationDockArgs): ElicitationDockState => {
    const pending = useMemo(
        () => (enabled ? getPendingElicitationInteractions(messages) : []),
        [messages, enabled],
    )
    const degradedEarlierInTurn = useMemo(
        () => (enabled ? hasEarlierElicitationDegradation(messages) : false),
        [messages, enabled],
    )

    const front = pending[0] ?? null

    // An unrenderable payload settles `errorText` once so the run resumes; a repeat malformed
    // emission parks instead, which is what breaks the settle -> resume -> re-emit loop.
    const degradedRef = useRef(new Set<string>())
    useEffect(() => {
        if (!front || front.settled || degradedEarlierInTurn) return
        if (!payloadArrived(front) || degradedRef.current.has(front.toolCallId)) return
        const parsed = parseElicitationPayload(front.input)
        if (parsed.ok) return
        degradedRef.current.add(front.toolCallId)
        onOutput?.({
            toolName: front.toolName,
            toolCallId: front.toolCallId,
            errorText: buildDegradationErrorText(parsed.reason),
        })
    }, [front, degradedEarlierInTurn, onOutput])

    // Calls whose answer is out but whose transcript row has not come back. Keyed rather than a
    // bare flag so it survives the dock's closing animation (`shown` still holds the settled
    // calls) and cannot leak onto the agent's next ask. `pending` is read through a ref: the host
    // calls `dismiss` from a send handler whose closure may predate the current transcript. The
    // sibling of `useConnectionDock`'s, down to the recovery — keep the two in step.
    const pendingRef = useRef(pending)
    pendingRef.current = pending
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

    // A card answered itself. The write still has to reach the server and come back through the
    // records, so hide the card on the way out and give it back only if it never landed.
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
        // No settle channel means nothing can be written, so nothing is dismissed. Checked before
        // the markers go up: closing the dock over a question that is still parked would hide it.
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
                        output: buildCancelResult("Dismissed the request.") as unknown as Record<
                            string,
                            unknown
                        >,
                    }),
                ),
            )
            if (landed.some((result) => result === false))
                throw new Error("The question couldn't be dismissed.")
            // Only once they landed: a failed write re-opens the dock, and the cards must find the
            // answers the user had already typed.
            for (const meta of targets) discardElicitationDraft(meta.toolCallId)
        } catch (error) {
            // The questions are still live: give the dock back.
            forgetSettling(targets.map((meta) => meta.toolCallId))
            throw error
        }
    }, [onOutput, markSettling, forgetSettling])

    // Hold the last non-empty view so a host can animate the dock closed around content already gone.
    // An answered or dismissed dock closes at once: what replaced it is the thing to look at, and
    // the cards only return if a write fails.
    const open = pending.length > 0 && !pending.every((meta) => settlingIds.has(meta.toolCallId))
    const shownRef = useRef<ClientToolMeta[]>([])
    if (open) shownRef.current = pending
    const shown = shownRef.current

    return {
        open,
        front: shown[0] ?? null,
        queue: shown,
        shortcutsEnabled: !approvalsPending,
        dismiss,
        settle,
        settlingIds,
    }
}
