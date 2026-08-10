// Assembled from the behavior half of
// web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx (2026-07-25): the
// `getPendingApprovals` extraction, the shown-set latch (`resolvingIds` freeze so a
// multi-gate resolve doesn't step through the batch), the `responding` reset on gate change,
// and the respond / approve-all fan-out. The desktop dock keeps its own chrome on top.
// Deliberately omitted (desktop-only): the "always allow this tool" grant (an app-layer
// config write-through), the friendly per-tool body registry, and the trace link — the skin
// supplies those around this hook's state.
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {UIMessage} from "ai"

import {getPendingApprovals, type PendingApproval} from "../model/approvals"

export interface UseApprovalDockArgs {
    messages: UIMessage[]
    /** Answer one gate — the host's approval-response path (which marks the resume live). */
    respond: (args: {id: string; approved: boolean}) => void
}

export interface ApprovalDock {
    /** The run is paused on at least one gate — the dock should be visible. */
    open: boolean
    /** The gate to act on now (index 0 of the latched shown set); null when nothing is pending. */
    current: PendingApproval | null
    /** How many gates the paused turn holds (the "1 of N" figure). */
    count: number
    /** A fired decision hasn't settled yet — disable the action buttons. */
    responding: boolean
    /** Answer the current gate. */
    respond: (approved: boolean) => void
    /** Approve every pending gate in one step (the shown set is frozen while they settle). */
    approveAll: () => void
}

/**
 * Headless human-in-the-loop dock state: which gate is current, how many are pending, and the
 * one-at-a-time / approve-all response fan-out. A turn can request several gates at once; we act
 * on the first and let the SDK flip its state, which re-renders us onto the next — so
 * `responding` resets whenever the current id changes.
 */
export const useApprovalDock = ({
    messages,
    respond: onRespond,
}: UseApprovalDockArgs): ApprovalDock => {
    const approvals = useMemo(() => getPendingApprovals(messages), [messages])
    const open = approvals.length > 0

    // A resolve can answer SEVERAL gates at once ("Approve all"). Each response settles
    // asynchronously (the SDK's serial job queue), so the pending set shrinks across renders;
    // without a latch the dock would step through the batch ("1 of 3 → 1 of 2"). `resolvingIds`
    // holds the gates we fired responses for; while any is still pending we FREEZE the shown set
    // so the card holds steady and the dock closes in one step (or, if only some gates were
    // covered, then steps to the uncovered remainder).
    const [resolvingIds, setResolvingIds] = useState<readonly string[] | null>(null)
    const resolving =
        resolvingIds !== null && approvals.some((a) => resolvingIds.includes(a.approvalId))
    // Latch the last non-empty set so the card stays visible while the dock animates closed AND
    // so a multi-gate resolve doesn't step through the batch.
    const shownRef = useRef(approvals)
    if (open && !resolving) shownRef.current = approvals
    const shown = shownRef.current
    const current = shown[0] ?? null
    const count = shown.length

    const [responding, setResponding] = useState(false)

    // The current gate changed (we answered one, the next slid in) — re-enable. Held during a
    // resolve (current is frozen), so it fires only on a real step or a new batch.
    useEffect(() => {
        setResponding(false)
    }, [current?.approvalId])

    // Once every gate we fired has settled (left the pending set), drop the latch — the dock then
    // closes if nothing remains, or re-latches onto the uncovered gates (a mixed batch).
    useEffect(() => {
        if (resolvingIds !== null && !approvals.some((a) => resolvingIds.includes(a.approvalId))) {
            setResolvingIds(null)
        }
    }, [approvals, resolvingIds])

    const respond = useCallback(
        (approved: boolean) => {
            if (responding || !current) return
            setResponding(true)
            onRespond({id: current.approvalId, approved})
        },
        [responding, current, onRespond],
    )

    const approveAll = useCallback(() => {
        if (responding || shown.length === 0) return
        setResponding(true)
        // Freeze the card so the dock doesn't step through the batch as each response settles —
        // it holds "1 of N" and closes once all are answered (see `resolvingIds`).
        setResolvingIds(shown.map((a) => a.approvalId))
        shown.forEach((a) => onRespond({id: a.approvalId, approved: true}))
    }, [responding, shown, onRespond])

    return {open, current, count, responding, respond, approveAll}
}
