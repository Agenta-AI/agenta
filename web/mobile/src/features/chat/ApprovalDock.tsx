import {useEffect, useState} from "react"

import type {PendingApproval} from "@agenta/chat/model"

import {summarizeApprovalInput} from "./approvalInputSummary"
import {isSteerEnabled} from "./steer"
import type {ApprovalActions} from "./useApprovalActions"

/**
 * Bottom-anchored human-in-the-loop dock — the mobile shape of the desktop ApprovalDock.
 * It sits outside the transcript scroller (a shrink-0 sibling at the end of the screen's
 * flex column) so a paused run can never scroll out of reach, and it owns the decision:
 * the inline tool row is only an "Awaiting approval" marker. A turn can request several
 * gates at once — we act on the first and surface the count, with Approve all for the batch.
 */
export const ApprovalDock = ({
    approvals,
    actions,
}: {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    actions: ApprovalActions
}) => {
    const current = approvals[0]
    // Steer-lite: an optional redirect note sent WITH the denial. Flag-gated — see [[isSteerEnabled]].
    const [steerOpen, setSteerOpen] = useState(false)
    const [steerMessage, setSteerMessage] = useState("")
    const currentId = current?.approvalId
    useEffect(() => {
        setSteerOpen(false)
        setSteerMessage("")
    }, [currentId])

    if (!current) return null
    const count = approvals.length
    const busy = actions.phase === "resuming"
    const summary = summarizeApprovalInput(current.input)
    const canSteer = isSteerEnabled()
    return (
        <div className="border-border bg-background shrink-0 border-t px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <div className="flex items-center gap-2">
                <p className="text-xs font-medium">Approval needed to continue</p>
                {count > 1 ? (
                    <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                        {count} pending
                    </span>
                ) : null}
            </div>
            <p className="mt-1 truncate text-xs font-medium" title={current.toolName}>
                {current.toolName}
            </p>
            {summary.text ? (
                <div className="bg-muted mt-2 rounded p-2">
                    <p className="text-muted-foreground text-[11px]">{summary.label}</p>
                    <pre className="mt-0.5 max-h-24 overflow-auto overscroll-contain whitespace-pre-wrap break-all font-mono text-[11px] leading-snug">
                        {summary.text}
                    </pre>
                </div>
            ) : null}
            {/* While steering, the redirect panel replaces the decision row: an explicit
                deny+redirect shouldn't leave Approve competing with it. */}
            {steerOpen ? (
                <div className="mt-3 flex flex-col gap-2">
                    <p className="text-muted-foreground text-[11px]">
                        Deny this step and tell the agent what to do instead.
                    </p>
                    <textarea
                        autoFocus
                        rows={3}
                        value={steerMessage}
                        onChange={(event) => setSteerMessage(event.target.value)}
                        disabled={busy}
                        placeholder="e.g. write to staging, not prod"
                        className="border-border bg-muted resize-none rounded border p-2 text-xs disabled:opacity-50"
                    />
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={busy}
                            className="text-muted-foreground min-h-11 px-1 text-xs disabled:opacity-50"
                            onClick={() => setSteerOpen(false)}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            disabled={busy || !steerMessage.trim()}
                            className="border-border ml-auto min-h-11 rounded border px-3 text-xs disabled:opacity-50"
                            onClick={() =>
                                actions.respond({
                                    approvalId: current.approvalId,
                                    approved: false,
                                    message: steerMessage,
                                })
                            }
                        >
                            Deny &amp; send
                        </button>
                    </div>
                </div>
            ) : (
                <div className="mt-3 flex items-center gap-2">
                    {count > 1 ? (
                        <button
                            type="button"
                            disabled={busy}
                            className="border-border min-h-11 rounded border px-3 text-xs disabled:opacity-50"
                            onClick={() => actions.approveAll()}
                        >
                            Approve all
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={busy}
                        className="border-border min-h-11 rounded border px-3 text-xs disabled:opacity-50"
                        onClick={() =>
                            actions.respond({approvalId: current.approvalId, approved: false})
                        }
                    >
                        Deny
                    </button>
                    {canSteer ? (
                        <button
                            type="button"
                            disabled={busy}
                            className="text-muted-foreground min-h-11 px-1 text-xs disabled:opacity-50"
                            onClick={() => setSteerOpen(true)}
                        >
                            Redirect
                        </button>
                    ) : null}
                    <button
                        type="button"
                        disabled={busy}
                        className="bg-primary text-primary-foreground ml-auto min-h-11 rounded px-4 text-xs font-medium disabled:opacity-50"
                        onClick={() =>
                            actions.respond({approvalId: current.approvalId, approved: true})
                        }
                    >
                        Approve
                    </button>
                </div>
            )}
            {busy ? <p className="text-muted-foreground mt-2 text-xs">Resuming…</p> : null}
            {actions.phase === "error" && actions.errorText ? (
                <p className="text-destructive mt-2 text-xs">{actions.errorText}</p>
            ) : null}
        </div>
    )
}
