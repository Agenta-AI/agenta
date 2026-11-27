import type {ReactNode} from "react"

import {ApprovalCard} from "@agenta/chat/components"
import type {PendingApproval} from "@agenta/chat/model"

import {ContentRail} from "@/components/ContentRail"

import {useIsBuilderChat} from "./builderChat"
import {ownsShortcutAt} from "./conversationFocus"
import {isSteerEnabled} from "./steer"
import type {ApprovalActions} from "./useApprovalActions"
import {useBuilderApprovalChoices} from "./useBuilderApprovalChoices"

/**
 * Bottom-anchored human-in-the-loop dock — the SAME `ApprovalCard` the desktop dock renders
 * (eyebrow, one-sentence ask, detail toggle, always-allow), in touch sizing. This wrapper
 * is only the mobile adapter: the safe-area footer shell and how a response actually fires
 * (the engine for plain approve/deny + Approve all; the detached resume for a steer note). It
 * sits outside the transcript scroller so a paused run can never scroll out of reach.
 *
 * Batch deny rides the detached dispatcher; where a host supplies none, Deny steps gate by gate.
 */
export const ApprovalDock = ({
    approvals,
    actions,
    entityId,
    bottomMost = true,
    phoneBottomMost = false,
    readOnly = false,
    readOnlyNote,
    privateSession = false,
    heading,
    shortcuts = true,
}: {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    actions: ApprovalActions
    /** The agent revision — enables "always allow" (a draft-config grant); absent on replay. */
    entityId?: string
    /** False when the composer renders below — only the bottom-most element pads the safe area. */
    bottomMost?: boolean
    /** On a phone the composer hides while the card waits, so the card pads the safe area there. */
    phoneBottomMost?: boolean
    /** The reader cannot answer (no `can_send`, or not known yet): the card shows, but answers
     *  nothing, and no shortcut or tap reaches `actions`. */
    readOnly?: boolean
    /** Shown in place of the actions while read-only (it names who can answer). */
    readOnlyNote?: string | null
    /** The session is private to the reader (`isPrivateToViewer`). False while unknown. */
    privateSession?: boolean
    /** A line above the card: on another session's card, which session asks. */
    heading?: ReactNode
    /** False for another session's card, so the chat's own shortcuts answer only its own card. */
    shortcuts?: boolean
}) => {
    const locked = readOnly || Boolean(readOnlyNote)
    const builderChat = useIsBuilderChat()
    // In the builder chat, "Always auto-approve" stores the person's choice (design D32). The
    // server applies it only in a session private to the person, so only such a session offers it.
    const {alwaysApprove} = useBuilderApprovalChoices(builderChat && privateSession)
    const busy = actions.phase === "resuming"
    const answered = actions.phase === "answered" || actions.phase === "recoverable"

    if (approvals.length === 0) return null
    return (
        <div
            // The card sits 16 px in: the builder panel (S03) and a phone (M05).
            className={`bg-background shrink-0 px-4 pt-3 ${
                // When the composer sits below it brings its own top padding, so only the
                // bottom-most dock pads the safe area — a full pb here just doubles the gap.
                bottomMost ? "pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : "pb-0"
            } ${phoneBottomMost ? "max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))]" : ""}`}
        >
            <ContentRail>
                {heading ? (
                    <p className="text-muted-foreground m-0 mb-1.5 truncate text-meta">{heading}</p>
                ) : null}
                <ApprovalCard
                    approvals={approvals}
                    responding={busy}
                    answered={answered}
                    recoverable={actions.phase === "recoverable"}
                    entityId={entityId}
                    steerEnabled={isSteerEnabled()}
                    touch
                    readOnly={locked}
                    readOnlyNote={readOnlyNote}
                    alwaysAllowOffered={!builderChat}
                    alwaysApprove={alwaysApprove}
                    // Two conversations can each show a card: a key answers the focused one only.
                    // Another session's card (shortcuts off) never takes the keys.
                    ownsShortcut={shortcuts ? ownsShortcutAt : () => false}
                    errorText={actions.phase === "error" ? actions.errorText : null}
                    onRespond={({approvalId, approved, message}) => {
                        if (!locked) actions.respond({approvalId, approved, message})
                    }}
                    onApproveAll={() => {
                        if (!locked) actions.approveAll()
                    }}
                    onDenyAll={actions.denyAll && !locked ? () => actions.denyAll?.() : undefined}
                />
            </ContentRail>
        </div>
    )
}
