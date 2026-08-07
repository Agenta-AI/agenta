import type {PendingApproval} from "@agenta/chat/model"

import {summarizeApprovalInput} from "./approvalInputSummary"
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
    if (!current) return null
    const count = approvals.length
    const busy = actions.phase === "resuming"
    const summary = summarizeApprovalInput(current.input)
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
            {busy ? <p className="text-muted-foreground mt-2 text-xs">Resuming…</p> : null}
            {actions.phase === "error" && actions.errorText ? (
                <p className="text-destructive mt-2 text-xs">{actions.errorText}</p>
            ) : null}
        </div>
    )
}
