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

import type {ApprovalSubmissionOutcome} from "../assets/serverOwnedApproval"
import {getPendingApprovals, type PendingApproval} from "../model/approvals"

type ApprovalResponse = void | ApprovalSubmissionOutcome

export interface UseApprovalDockArgs {
    messages: UIMessage[]
    /** Answer one gate — the host's approval-response path (which marks the resume live). */
    respond: (args: {id: string; approved: boolean}) => ApprovalResponse | Promise<ApprovalResponse>
    /** Answer one paused turn's shown gates in a single server transaction. */
    respondAll?: (args: {
        ids: string[]
        approved: boolean
    }) => ApprovalResponse | Promise<ApprovalResponse>
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
    /** The server accepted the durable response; wait for records to replace the parked gate. */
    answered: boolean
    /** The answer is durable, but delivery needs the user's next Send to retry. */
    recoverable: boolean
    errorText: string | null
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
    respondAll: onRespondAll,
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
    const currentIdRef = useRef(current?.approvalId)
    currentIdRef.current = current?.approvalId

    const [responding, setResponding] = useState(false)
    const [answered, setAnswered] = useState(false)
    const [recoverable, setRecoverable] = useState(false)
    const [errorText, setErrorText] = useState<string | null>(null)

    // The current gate changed (we answered one, the next slid in) — re-enable. Held during a
    // resolve (current is frozen), so it fires only on a real step or a new batch.
    useEffect(() => {
        setResponding(false)
        setAnswered(false)
        setRecoverable(false)
        setErrorText(null)
    }, [current?.approvalId])

    const settle = useCallback(
        async (
            responses: (ApprovalResponse | Promise<ApprovalResponse>)[],
            ownerId: string | undefined,
        ) => {
            const results = await Promise.allSettled(responses)
            if (currentIdRef.current !== ownerId) return
            const failed = results.find(
                (result): result is PromiseRejectedResult => result.status === "rejected",
            )
            if (!failed) {
                setRecoverable(
                    results.some(
                        (result) =>
                            result.status === "fulfilled" && result.value?.recoverable === true,
                    ),
                )
                setAnswered(true)
                return
            }
            setResponding(false)
            setResolvingIds(null)
            setErrorText(
                failed.reason instanceof Error
                    ? failed.reason.message
                    : "Approval failed. Please try again.",
            )
        },
        [],
    )

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
            setErrorText(null)
            void settle([onRespond({id: current.approvalId, approved})], current.approvalId)
        },
        [responding, current, onRespond, settle],
    )

    const approveAll = useCallback(() => {
        if (responding || shown.length === 0) return
        setResponding(true)
        setErrorText(null)
        // Freeze the card so the dock doesn't step through the batch as each response settles —
        // it holds "1 of N" and closes once all are answered (see `resolvingIds`).
        setResolvingIds(shown.map((a) => a.approvalId))
        const ids = shown.map((approval) => approval.approvalId)
        void settle(
            onRespondAll
                ? [onRespondAll({ids, approved: true})]
                : ids.map((id) => onRespond({id, approved: true})),
            ids[0],
        )
    }, [responding, shown, onRespond, onRespondAll, settle])

    return {open, current, count, responding, answered, recoverable, errorText, respond, approveAll}
}
