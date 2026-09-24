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
import {useCallback, useEffect, useMemo, useRef} from "react"

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
import {useSettlingIds} from "./useSettlingIds"

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
    /** The cards' settle channel: `onOutput` wrapped to close the dock as the answer leaves. */
    settle: ClientToolOutputHandler
    /** Calls answered here whose transcript rows have not arrived. */
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

    // `pending` through a ref: the host calls `dismiss` from a send handler with a stale closure.
    const pendingRef = useRef(pending)
    pendingRef.current = pending
    const {settlingIds, mark, forget, isSettling, settle} = useSettlingIds(pending, onOutput)

    const dismiss = useCallback(async () => {
        // No settle channel means nothing can be written, so nothing is dismissed. Checked before
        // the markers go up: closing the dock over a question that is still parked would hide it.
        if (!onOutput) return
        const targets = pendingRef.current.filter(
            (meta) => !meta.settled && !isSettling(meta.toolCallId),
        )
        if (targets.length === 0) return
        mark(targets.map((meta) => meta.toolCallId))
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
            forget(targets.map((meta) => meta.toolCallId))
            throw error
        }
    }, [onOutput, mark, forget, isSettling])

    // A card whose answer is out can never be the front one the actions address.
    const live = useMemo(
        () => pending.filter((meta) => !settlingIds.has(meta.toolCallId)),
        [pending, settlingIds],
    )
    // Hold the last non-empty view so a host can animate the dock closed around content already gone.
    const open = live.length > 0
    const shownRef = useRef<ClientToolMeta[]>([])
    if (open) shownRef.current = live
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
