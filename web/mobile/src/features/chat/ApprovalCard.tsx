/** Raw highlighted pending-approval block: tool name + exact payload. Read-only until M1
 * wires the resume path — buttons stay disabled with honest copy. */
export const ApprovalCard = ({toolName, input}: {toolName: string; input: unknown}) => (
    <div className="border-primary flex flex-col gap-2 rounded border p-3">
        <p className="text-xs font-medium">Approval pending — {toolName}</p>
        <pre className="text-muted-foreground max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
            {JSON.stringify(input, null, 2)}
        </pre>
        <div className="flex items-center gap-2">
            <button
                type="button"
                disabled
                className="border-border text-muted-foreground rounded border px-3 py-1 text-xs"
            >
                Approve
            </button>
            <button
                type="button"
                disabled
                className="border-border text-muted-foreground rounded border px-3 py-1 text-xs"
            >
                Deny
            </button>
        </div>
        <p className="text-muted-foreground text-xs">Answer on desktop for now.</p>
    </div>
)
