import {memo, useEffect, useRef, useState} from "react"

import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"
import {HeightCollapse} from "@agenta/ui"

import {isAgentChatSteerEnabled} from "../assets/constants"

interface ApprovalDockProps {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    onApprovalResponse: (args: {
        id: string
        approved: boolean
        message?: string
    }) => void | Promise<void>
    /** Selected agent revision — enables the always-allow grant. */
    entityId?: string
    className?: string
}

/**
 * Persistent human-in-the-loop approval band. Lives in the composer region (between the transcript
 * and the input), NOT in the scrolling transcript, so a run paused on a tool gate can't scroll out
 * of reach. The card itself is the shared `ApprovalCard` (mobile renders the same one, in the same
 * shape, for every user); this dock is the desktop adapter: it owns the open/close animation, the
 * multi-gate resolve latch, and how a response actually fires.
 */
const ApprovalDock = ({approvals, onApprovalResponse, entityId, className}: ApprovalDockProps) => {
    const open = approvals.length > 0
    // "Approve all" / "Deny all" answer SEVERAL gates at once, and each response settles
    // asynchronously (the SDK's serial job queue), so the pending set shrinks across renders.
    // `resolvingIds` holds the gates we fired for; while any is still pending the card stays frozen
    // on the latched set, instead of stepping through the batch as the answers land.
    const [resolvingIds, setResolvingIds] = useState<readonly string[] | null>(null)
    const resolving =
        resolvingIds !== null && approvals.some((a) => resolvingIds.includes(a.approvalId))
    // Latch the last non-empty set so the card stays visible while the dock animates closed.
    const shownRef = useRef(approvals)
    if (open && !resolving) shownRef.current = approvals
    const shown = shownRef.current
    const current = shown[0]

    const [responding, setResponding] = useState(false)
    const [answered, setAnswered] = useState(false)
    const [errorText, setErrorText] = useState<string | null>(null)
    // Feature flag: the "Redirect" (steer) control is OFF by default. The UI is complete, but the
    // redirect runs as a follow-up turn — the model reasons about the bare denial before it lands —
    // so we hide the entry point until the runner-level reject-and-redirect lands.
    const steerEnabled = isAgentChatSteerEnabled()

    // The current gate changed (we answered one, the next slid in) — re-enable.
    useEffect(() => {
        setResponding(false)
        setAnswered(false)
        setErrorText(null)
    }, [current?.approvalId])

    // Once every gate we fired has settled, drop the latch — the dock then closes if nothing
    // remains, or re-latches onto the uncovered gates.
    useEffect(() => {
        if (resolvingIds !== null && !approvals.some((a) => resolvingIds.includes(a.approvalId))) {
            setResolvingIds(null)
        }
    }, [approvals, resolvingIds])

    const settle = async (responses: (Promise<void> | void)[]) => {
        const results = await Promise.allSettled(responses)
        const failed = results.find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
        )
        if (!failed) {
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
    }

    const respondMany = (ids: string[], approved: boolean) => {
        if (responding) return
        setResponding(true)
        setErrorText(null)
        setResolvingIds(ids)
        void settle(ids.map((id) => onApprovalResponse({id, approved})))
    }

    // Always mounted; enter + leave animate via the shared HeightCollapse. `inert` while closed
    // drops the (clipped, latched) card from tab order + a11y.
    return (
        <HeightCollapse open={open} className={className} durationMs={240} fade inert>
            <div className="min-h-0">
                {current ? (
                    <ApprovalCard
                        approvals={shown}
                        responding={responding}
                        answered={answered}
                        errorText={errorText}
                        entityId={entityId}
                        steerEnabled={steerEnabled}
                        className="ag-surface-chat mb-2 gap-2.5 p-3.5"
                        onRespond={({approvalId, approved, message}) => {
                            if (responding) return
                            setResponding(true)
                            setErrorText(null)
                            void settle([
                                onApprovalResponse({
                                    id: approvalId,
                                    approved,
                                    ...(message?.trim() ? {message: message.trim()} : {}),
                                }),
                            ])
                        }}
                        onApproveAll={(ids) => respondMany(ids, true)}
                        onDenyAll={(ids) => respondMany(ids, false)}
                    />
                ) : null}
            </div>
        </HeightCollapse>
    )
}

export default memo(ApprovalDock)
