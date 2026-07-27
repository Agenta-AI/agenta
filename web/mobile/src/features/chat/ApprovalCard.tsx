import type {ApprovalActions} from "./useApprovalActions"

/**
 * Raw highlighted pending-approval block: tool name + exact payload + Approve/Deny (and
 * Approve-all when several gates are pending). Without `actions` it degrades to the read-only
 * M0 card ("answer on desktop"). Raw UI on purpose — flows over polish.
 */
export const ApprovalCard = ({
    toolName,
    input,
    approvalId,
    pendingCount = 0,
    actions,
}: {
    toolName: string
    input: unknown
    /** The gate's interaction id off the tool part (`approval.id`). */
    approvalId?: string
    /** Gates pending on the paused turn — >1 surfaces the Approve-all button. */
    pendingCount?: number
    actions?: ApprovalActions
}) => {
    const actionable = Boolean(actions && approvalId)
    const busy = actions?.phase === "resuming"
    const disabled = !actionable || busy
    return (
        <div className="border-primary flex flex-col gap-2 rounded border p-3">
            <p className="text-xs font-medium">Approval pending — {toolName}</p>
            <pre className="text-muted-foreground max-h-48 overflow-auto overscroll-contain whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(input, null, 2)}
            </pre>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    disabled={disabled}
                    className="border-border min-h-11 rounded border px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => approvalId && actions?.respond({approvalId, approved: true})}
                >
                    Approve
                </button>
                <button
                    type="button"
                    disabled={disabled}
                    className="border-border min-h-11 rounded border px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => approvalId && actions?.respond({approvalId, approved: false})}
                >
                    Deny
                </button>
                {actionable && pendingCount > 1 ? (
                    <button
                        type="button"
                        disabled={busy}
                        className="border-border min-h-11 rounded border px-3 py-1 text-xs disabled:opacity-50"
                        onClick={() => actions?.approveAll()}
                    >
                        Approve all {pendingCount}
                    </button>
                ) : null}
            </div>
            {busy ? <p className="text-muted-foreground text-xs">Resuming…</p> : null}
            {actions?.phase === "error" && actions.errorText ? (
                <p className="text-destructive text-xs">{actions.errorText}</p>
            ) : null}
            {!actionable ? (
                <p className="text-muted-foreground text-xs">Answer on desktop for now.</p>
            ) : null}
        </div>
    )
}
