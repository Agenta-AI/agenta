import {partToolName, rowSummary, type TurnViewModel} from "@agenta/chat/model"

/** One transcript turn: raw aligned text parts, one-line tool summaries, raw error line. */
export const TurnRow = ({turn}: {turn: TurnViewModel}) => (
    <div className={`flex ${turn.isUser ? "justify-end" : "justify-start"}`}>
        <div
            className={`flex max-w-[85%] flex-col gap-1 ${turn.isUser ? "items-end" : "items-start"}`}
        >
            {turn.items.map((item) => {
                if (item.kind === "part") {
                    if (item.part.type === "text") {
                        return (
                            <p key={item.index} className="whitespace-pre-wrap text-xs">
                                {item.part.text}
                            </p>
                        )
                    }
                    if (item.part.type === "reasoning") {
                        return (
                            <p
                                key={item.index}
                                className="text-muted-foreground whitespace-pre-wrap text-xs italic"
                            >
                                {item.part.text}
                            </p>
                        )
                    }
                    return null
                }
                if (item.kind === "tools") {
                    return (
                        <div key={item.index} className="flex flex-col gap-0.5">
                            {item.parts.map((part, i) => {
                                const summary = rowSummary(part)
                                return (
                                    <p
                                        key={part.toolCallId ?? `${item.index}-${i}`}
                                        className="text-muted-foreground text-xs"
                                    >
                                        {partToolName(part)} — {part.state}
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
