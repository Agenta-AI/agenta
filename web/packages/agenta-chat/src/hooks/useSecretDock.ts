/**
 * Headless state for the secret dock: the parked `request_secret` call the card answers. The
 * sibling of `useConnectionDock` and `useElicitationDock`, so a host settles all three the same way.
 */
import {useCallback, useMemo, useRef} from "react"

import type {UIMessage} from "ai"

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import {getPendingSecretInteractions} from "../clientTools/secretInteractions"
import type {ClientToolMeta} from "../skin"

import {useSettlingIds} from "./useSettlingIds"

export interface UseSecretDockArgs {
    messages: UIMessage[]
    /** False suppresses the dock (still streaming, or the run was stopped). */
    enabled?: boolean
    onOutput?: ClientToolOutputHandler
}

export interface SecretDockState {
    /** A secret request is parked: the dock should be visible. */
    open: boolean
    /** The request the card answers; null when nothing is parked. */
    front: ClientToolMeta | null
    /** Settle every parked request as the card's "Not now" would. Rejects (and re-opens the dock)
     *  when a write fails. A no-op while nothing is parked. */
    dismiss: () => Promise<void>
    /** The card's settle channel: `onOutput` wrapped to close the dock as the answer leaves. */
    settle: ClientToolOutputHandler
    /** Calls answered here whose transcript rows have not arrived. */
    settlingIds: ReadonlySet<string>
}

export const useSecretDock = ({
    messages,
    enabled = true,
    onOutput,
}: UseSecretDockArgs): SecretDockState => {
    const pending = useMemo(
        () => (enabled ? getPendingSecretInteractions(messages) : []),
        [messages, enabled],
    )
    const {settlingIds, settle, dismiss: dismissAll} = useSettlingIds(pending, onOutput)
    // `pending` through a ref: the host calls `dismiss` from a send handler with a stale closure.
    const pendingRef = useRef(pending)
    pendingRef.current = pending

    const dismiss = useCallback(async () => {
        await dismissAll(
            pendingRef.current,
            () => ({status: "cancelled"}),
            "The secret request couldn't be dismissed.",
        )
    }, [dismissAll])

    const front = pending.find((meta) => !settlingIds.has(meta.toolCallId)) ?? null
    return {open: front !== null, front, dismiss, settle, settlingIds}
}
