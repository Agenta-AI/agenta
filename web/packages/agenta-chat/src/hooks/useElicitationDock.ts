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
     * Settle the front card as its own ✕ would — a cancel; the card drops its draft — from
     * outside the card. The host calls this when the user sends a chat message over a parked question: the
     * message is the better answer, so the form goes and the message follows it in. Resolves once
     * the settle write lands; rejects (and re-arms the card) when it fails. A no-op while nothing
     * is parked or that same call is already on its way out.
     */
    dismiss: () => Promise<void>
    /** The front card is being dismissed from outside — it must show that, and take no answer. */
    dismissing: boolean
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

    // Hold the last non-empty view so a host can animate the dock closed around content already gone.
    const open = pending.length > 0
    const shownRef = useRef<ClientToolMeta[]>([])
    if (open) shownRef.current = pending
    const shown = shownRef.current

    // The host-driven dismiss, keyed by the call it settled. Keyed rather than a bare flag so it
    // survives the card's closing animation (`shown` still holds the settled call) and cannot
    // leak onto the next question. `front` is read through a ref: the host calls this from a
    // send handler whose closure may predate the current transcript.
    const frontRef = useRef(front)
    frontRef.current = front
    const [dismissingId, setDismissingId] = useState<string | null>(null)
    const dismissingRef = useRef<string | null>(null)
    const dismiss = useCallback(async () => {
        const target = frontRef.current
        if (!target || target.settled || dismissingRef.current === target.toolCallId) return
        dismissingRef.current = target.toolCallId
        setDismissingId(target.toolCallId)
        try {
            await onOutput?.({
                toolName: target.toolName,
                toolCallId: target.toolCallId,
                output: buildCancelResult("Dismissed the request.") as unknown as Record<
                    string,
                    unknown
                >,
            })
        } catch (error) {
            // The question is still live: give the card its controls back.
            dismissingRef.current = null
            setDismissingId(null)
            throw error
        }
    }, [onOutput])

    return {
        open,
        front: shown[0] ?? null,
        queue: shown,
        shortcutsEnabled: !approvalsPending,
        dismiss,
        dismissing: dismissingId !== null && dismissingId === shown[0]?.toolCallId,
    }
}
