import {useState} from "react"

import {partToolName, rowSummary, type TurnViewModel} from "@agenta/chat/model"
import {ChatBubble, ChatBubbleAvatar} from "@agenta/ui/components/presentational"
import {
    Ban,
    Bot,
    Brain,
    CheckCircle2,
    ChevronRight,
    CircleDashed,
    User,
    Wrench,
    XCircle,
} from "lucide-react"

import {AssistantMarkdown} from "./AssistantMarkdown"
import {AttachmentPart} from "./AttachmentPart"
import {isLiveTextItem} from "./markdownStream"

type ToolsItem = Extract<TurnViewModel["items"][number], {kind: "tools"}>

/** Desktop ReasoningPart's shape: a caret+brain toggle over a muted italic aside. */
const ReasoningFold = ({text, streaming}: {text: string; streaming: boolean}) => {
    const [manual, setManual] = useState<boolean | null>(null)
    const open = manual ?? streaming
    return (
        <div className="flex max-w-full flex-col">
            <button
                type="button"
                onClick={() => setManual(!open)}
                aria-expanded={open}
                className="text-colorTextSecondary -ml-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 text-xs italic"
            >
                <ChevronRight
                    className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
                />
                <Brain className="size-3" />
                <span>{streaming ? "Thinking…" : "Thought"}</span>
            </button>
            {open ? (
                <div className="text-colorTextTertiary ml-5 mt-1 whitespace-pre-wrap text-xs">
                    {text}
                </div>
            ) : null}
        </div>
    )
}

/** One tool group, desktop ToolActivity's header language: status glyph + name + summary. */
const ToolLines = ({item}: {item: ToolsItem}) => (
    <div className="flex flex-col gap-1 py-0.5">
        {item.parts.map((tool, i) => {
            const key = tool.toolCallId ?? `${item.index}-${i}`
            const state = tool.state as string
            // Desktop's per-state header language: a gate is a warning wrench marked "Awaiting
            // approval" (the decision lives in the bottom ApprovalDock), a denial gets the quiet
            // ban glyph, and everything unsettled spins.
            const awaiting = state === "approval-requested"
            const denied = state === "output-denied"
            const failed = state === "output-error"
            const settled = state === "output-available" || state === "approval-responded"
            const midText = awaiting ? "Awaiting approval" : denied ? "denied" : rowSummary(tool)
            return (
                <p key={key} className="m-0 flex min-w-0 items-center gap-2 text-xs">
                    {awaiting ? (
                        <Wrench className="text-colorWarning size-3.5 shrink-0" />
                    ) : denied ? (
                        <Ban className="text-colorTextTertiary size-3.5 shrink-0" />
                    ) : failed ? (
                        <XCircle className="text-colorError size-3.5 shrink-0" />
                    ) : settled ? (
                        <CheckCircle2 className="text-colorSuccess size-3.5 shrink-0" />
                    ) : (
                        <CircleDashed className="text-colorTextTertiary size-3.5 shrink-0 motion-safe:animate-spin" />
                    )}
                    <span className="text-colorText min-w-0 truncate font-medium">
                        {partToolName(tool)}
                    </span>
                    {midText ? (
                        <span
                            className={`min-w-0 truncate ${
                                failed ? "text-colorError" : "text-colorTextSecondary"
                            }`}
                        >
                            {midText}
                        </span>
                    ) : null}
                </p>
            )
        })}
    </div>
)

/** Desktop RunErrorBody's callout: the red card with a title and the reason inline. */
const RunErrorCallout = ({text}: {text: string}) => {
    const [expanded, setExpanded] = useState(false)
    const big = text.length > 240 || text.split("\n").length > 4
    return (
        <div className="bg-destructive/10 flex items-start gap-2 rounded-xl px-4 py-3">
            <XCircle className="text-colorError mt-px size-4 shrink-0" />
            <div className="flex min-w-0 flex-col items-start gap-0.5">
                <span className="text-colorError text-xs font-medium">The agent run failed</span>
                <span
                    className={`text-colorError whitespace-pre-wrap break-words text-xs ${
                        big && !expanded ? "line-clamp-3" : ""
                    }`}
                >
                    {text}
                </span>
                {big ? (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="text-colorError -ml-1 rounded px-1 py-0.5 text-[11px] font-medium"
                    >
                        {expanded ? "Show less" : "Show more"}
                    </button>
                ) : null}
            </div>
        </div>
    )
}

/**
 * One transcript turn on the shared bubble chrome — the mobile face of the desktop
 * AgentMessage: user turns as filled bubbles hugging the right, assistant turns flush on the
 * canvas, both with the 24px icon avatar; reasoning folds, tool lines with status glyphs, and
 * the red run-failure callout.
 */
export const TurnRow = ({turn}: {turn: TurnViewModel}) => {
    const body = (
        <div className="flex min-w-0 max-w-full flex-col gap-2">
            {turn.items.map((item, position) => {
                if (item.kind === "part") {
                    if (item.part.type === "text") {
                        // What the user typed renders literally — markdown in your own words
                        // is surprising (desktop parity).
                        if (turn.isUser) {
                            return (
                                <p
                                    key={item.index}
                                    className="m-0 whitespace-pre-wrap break-words text-xs"
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
                            <ReasoningFold
                                key={item.index}
                                text={item.part.text}
                                streaming={isLiveTextItem(turn, position)}
                            />
                        )
                    }
                    return null
                }
                if (item.kind === "tools") {
                    return <ToolLines key={item.index} item={item} />
                }
                // clientTool never occurs — the predicate defaults to false on mobile.
                return null
            })}
            {turn.status.showError ? (
                <RunErrorCallout text={turn.status.errorText ?? "Something went wrong."} />
            ) : null}
        </div>
    )

    return (
        <div className={`flex ${turn.isUser ? "justify-end" : "justify-start"}`}>
            <ChatBubble
                placement={turn.isUser ? "end" : "start"}
                variant={turn.isUser ? "filled" : "borderless"}
                avatar={
                    <ChatBubbleAvatar
                        icon={
                            turn.isUser ? <User className="size-4" /> : <Bot className="size-4" />
                        }
                    />
                }
                className="min-w-0 max-w-[85%]"
                classNames={{
                    content: "min-w-0 max-w-full overflow-hidden text-xs",
                    body: "min-w-0 max-w-full overflow-hidden",
                }}
                content={body}
            />
        </div>
    )
}
