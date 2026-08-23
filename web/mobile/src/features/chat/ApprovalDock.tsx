import {useEffect, useState} from "react"

import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"

import {ContentRail} from "@/components/ContentRail"

import {isSteerEnabled} from "./steer"
import type {ApprovalActions} from "./useApprovalActions"

/**
 * Bottom-anchored human-in-the-loop dock — the SAME `ApprovalCard` the desktop dock renders
 * (frame, decision row, batch peek, steer panel, always-allow), in touch sizing. This wrapper
 * is only the mobile adapter: the safe-area footer shell and how a response actually fires
 * (the engine for plain approve/deny + Approve all; the detached resume for a steer note). It
 * sits outside the transcript scroller so a paused run can never scroll out of reach.
 *
 * No `onDenyAll` yet: the engine has no batch deny, so the peek hides that action here.
 */
export const ApprovalDock = ({
    approvals,
    actions,
    entityId,
    bottomMost = true,
}: {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    actions: ApprovalActions
    /** The agent revision — enables "always allow" (a draft-config grant); absent on replay. */
    entityId?: string
    /** False when the composer renders below — only the bottom-most element pads the safe area. */
    bottomMost?: boolean
}) => {
    // Which action fired, for the card's spinner placement (the engine only reports "busy").
    const [source, setSource] = useState<"one" | "all" | null>(null)
    const busy = actions.phase === "resuming"
    useEffect(() => {
        if (!busy) setSource(null)
    }, [busy])

    if (approvals.length === 0) return null
    return (
        <div
            className={`bg-background shrink-0 px-3 pt-3 ${
                bottomMost ? "pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "pb-3"
            }`}
        >
            <ContentRail>
                <ApprovalCard
                    approvals={approvals}
                    responding={busy}
                    respondingSource={source}
                    entityId={entityId}
                    steerEnabled={isSteerEnabled()}
                    touch
                    errorText={actions.phase === "error" ? actions.errorText : null}
                    onRespond={({approvalId, approved, message}) => {
                        setSource("one")
                        actions.respond({approvalId, approved, message})
                    }}
                    onApproveAll={() => {
                        setSource("all")
                        actions.approveAll()
                    }}
                />
            </ContentRail>
        </div>
    )
}
