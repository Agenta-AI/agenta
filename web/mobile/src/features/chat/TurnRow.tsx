import {partToolName, rowSummary, type TurnViewModel} from "@agenta/chat/model"

import {AssistantMarkdown} from "./AssistantMarkdown"
import {AttachmentPart} from "./AttachmentPart"
import {isLiveTextItem} from "./markdownStream"

/** One transcript turn: markdown text, attachments, one-line tool summaries, raw error line. */
export const TurnRow = ({turn}: {turn: TurnViewModel}) => (
    <div className={`flex ${turn.isUser ? "justify-end" : "justify-start"}`}>
        <div
            className={`flex min-w-0 max-w-[85%] flex-col gap-1 ${turn.isUser ? "items-end" : "items-start"}`}
        >
            {turn.items.map((item, position) => {
                if (item.kind === "part") {
                    if (item.part.type === "text") {
                        // Desktop parity: only user messages get a bubble, and what the user
                        // typed renders literally — markdown in your own words is surprising.
                        if (turn.isUser) {
                            return (
                                <p
                                    key={item.index}
                                    className="bg-muted rounded-lg px-3 py-2 whitespace-pre-wrap text-xs"
                                >
                                    {item.part.text}
                                </p>
                            )
                        }
                        return (
                            <AssistantMarkdown
                                key={item.index}
                                streaming={isLiveTextItem(turn, position)}
                                text={item.part.text}
                            />
                        )
                    }
                    if (item.part.type === "file") {
                        return <AttachmentPart key={item.index} part={item.part} />
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
                                    // The decision lives in the bottom ApprovalDock; the row is
                                    // just the marker (desktop parity).
                                    return (
                                        <p key={key} className="text-muted-foreground text-xs">
                                            Awaiting approval — {partToolName(part)}
                                        </p>
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
