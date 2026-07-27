import {partToolName, rowSummary, type TurnViewModel} from "@agenta/chat/model"

import {ApprovalCard} from "./ApprovalCard"
import type {ApprovalActions} from "./useApprovalActions"

/** One transcript turn: raw aligned text parts, one-line tool summaries, raw error line. */
export const TurnRow = ({
    turn,
    approvalActions,
    pendingApprovals = 0,
}: {
    turn: TurnViewModel
    /** Resume actions for pending-approval cards (absent = read-only cards). */
    approvalActions?: ApprovalActions
    pendingApprovals?: number
}) => (
    <div className={`flex ${turn.isUser ? "justify-end" : "justify-start"}`}>
        <div
            className={`flex max-w-[85%] flex-col gap-1 ${turn.isUser ? "items-end" : "items-start"}`}
        >
            {turn.items.map((item) => {
                if (item.kind === "part") {
                    if (item.part.type === "text") {
                        return (
                            <p
                                key={item.index}
                                className={`whitespace-pre-wrap text-xs ${
                                    // Desktop parity: only user messages get a bubble, and the
                                    // brand accent stays reserved for CTAs — muted fill here.
                                    turn.isUser ? "bg-muted rounded-lg px-3 py-2" : ""
                                }`}
                            >
                                {item.part.text}
                            </p>
                        )
                    }
                    if (item.part.type === "reasoning") {
                        return (
                            <details key={item.index} className="max-w-full">
                                <summary className="text-muted-foreground cursor-pointer select-none text-xs">
                                    Thoughts
                                </summary>
                                <p className="text-muted-foreground border-border mt-1 border-l-2 pl-2 whitespace-pre-wrap text-xs italic">
                                    {item.part.text}
                                </p>
                            </details>
                        )
                    }
                    return null
                }
                if (item.kind === "tools") {
                    return (
                        <div key={item.index} className="flex flex-col gap-0.5">
                            {item.parts.map((part, i) => {
                                const key = part.toolCallId ?? `${item.index}-${i}`
                                if (part.state === "approval-requested") {
                                    const approvalId = (part as {approval?: {id?: string}}).approval
                                        ?.id
                                    return (
                                        <ApprovalCard
                                            key={key}
                                            toolName={partToolName(part)}
                                            input={part.input}
                                            approvalId={approvalId}
                                            pendingCount={pendingApprovals}
                                            actions={approvalActions}
                                        />
                                    )
                                }
                                const summary = rowSummary(part)
                                return (
                                    <p key={key} className="text-muted-foreground text-xs">
                                        {partToolName(part)} — {part.state ?? "pending"}
                                        {summary ? ` · ${summary}` : ""}
                                    </p>
                                )
                            })}
                        </div>
                    )
                }
                // clientTool never occurs — the predicate defaults to false on mobile.
                return null
            })}
            {turn.status.showError ? (
                <p className="text-destructive text-xs">
                    {turn.status.errorText ?? "Something went wrong."}
                </p>
            ) : null}
        </div>
    </div>
)
