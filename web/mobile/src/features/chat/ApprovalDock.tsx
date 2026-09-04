import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"

import {ContentRail} from "@/components/ContentRail"

import {isSteerEnabled} from "./steer"
import type {ApprovalActions} from "./useApprovalActions"

/**
 * Bottom-anchored human-in-the-loop dock — the SAME `ApprovalCard` the desktop dock renders
 * (eyebrow, one-sentence ask, detail toggle, always-allow), in touch sizing. This wrapper
 * is only the mobile adapter: the safe-area footer shell and how a response actually fires
 * (the engine for plain approve/deny + Approve all; the detached resume for a steer note). It
 * sits outside the transcript scroller so a paused run can never scroll out of reach.
 *
 * No `onDenyAll`: the engine has no batch deny, so Deny answers the current gate and steps.
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
    const busy = actions.phase === "resuming"
    const answered = actions.phase === "answered"

    if (approvals.length === 0) return null
    return (
        <div
            className={`bg-background shrink-0 px-3 pt-3 ${
                // When the composer sits below it brings its own top padding, so only the
                // bottom-most dock pads the safe area — a full pb here just doubles the gap.
                bottomMost ? "pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "pb-0"
            }`}
        >
            <ContentRail>
                <ApprovalCard
                    approvals={approvals}
                    responding={busy}
                    answered={answered}
                    entityId={entityId}
                    steerEnabled={isSteerEnabled()}
                    touch
                    errorText={actions.phase === "error" ? actions.errorText : null}
                    onRespond={({approvalId, approved, message}) =>
                        actions.respond({approvalId, approved, message})
                    }
                    onApproveAll={() => actions.approveAll()}
                />
            </ContentRail>
        </div>
    )
}
