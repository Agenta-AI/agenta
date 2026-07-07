import {memo, type ReactNode} from "react"

import {CopyButton} from "@agenta/ui"
import {CheckCircle, CircleNotch, Prohibit, Warning} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Typography} from "antd"

import {formatToolValue, stripFence} from "../../assets/toolFormat"

const {Text} = Typography

/** Icon-only copy affordance sized for the inspector's compact label rows. */
const CopyIcon = ({text}: {text: string}) => (
    <CopyButton
        text={text}
        icon
        buttonText={null}
        type="text"
        size="small"
        className="!h-5 !w-5 !min-w-0 shrink-0 !p-0 !text-colorTextTertiary"
    />
)

const isToolPart = (t: string) => t.startsWith("tool-") || t === "dynamic-tool"

const toolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

const userText = (message: UIMessage): string =>
    (message.parts ?? [])
        .filter((p) => (p as {type?: string}).type === "text")
        .map((p) => (p as {text?: string}).text ?? "")
        .join("\n")
        .trim()

const Block = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center justify-between font-mono text-[10px] text-colorTextTertiary">
            {label}
            <CopyIcon text={value} />
        </span>
        <pre
            className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug ${
                danger
                    ? "ag-surface-error-well !text-colorErrorText"
                    : "ag-surface-inset text-colorTextSecondary"
            }`}
        >
            {value}
        </pre>
    </div>
)

const ToolStatus = ({state}: {state: string}) => {
    if (state === "output-available")
        return <CheckCircle size={13} weight="fill" className="shrink-0 text-colorSuccess" />
    if (state === "output-error")
        return <Warning size={13} weight="fill" className="shrink-0 text-colorError" />
    if (state === "output-denied")
        return <Prohibit size={13} className="shrink-0 text-colorTextTertiary" />
    return <CircleNotch size={13} className="shrink-0 animate-spin text-colorPrimary" />
}

/** A labeled, left-ruled timeline row (user message / reasoning / response). */
const Row = ({
    label,
    accent,
    copyText,
    children,
}: {
    label: string
    accent?: boolean
    copyText?: string
    children: ReactNode
}) => (
    <div
        className={`flex flex-col gap-1 border-0 border-l-2 border-solid pl-3 ${
            accent ? "border-colorPrimary" : "border-colorBorderSecondary"
        }`}
    >
        <div className="flex items-center justify-between">
            <Text type="secondary" className="!text-[11px] font-medium">
                {label}
            </Text>
            {copyText ? <CopyIcon text={copyText} /> : null}
        </div>
        {children}
    </div>
)

/** A tool call as a distinct, inspectable step card: status + name, then input and output/error. */
const ToolStep = ({part}: {part: ToolUIPart}) => {
    const state = part.state as string
    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText
    return (
        <div className="ag-surface-card flex flex-col gap-1.5 rounded-[11px] p-2.5">
            <div className="flex min-w-0 items-center gap-2">
                <ToolStatus state={state} />
                <Text
                    className="!text-xs !font-medium font-mono min-w-0 truncate"
                    title={toolName(part)}
                >
                    {toolName(part)}
                </Text>
                <span
                    className={`ml-auto shrink-0 rounded px-1.5 py-px font-mono text-[10px] ${
                        state === "output-error"
                            ? "ag-status-error"
                            : state === "output-available"
                              ? "ag-status-success"
                              : "ag-surface-chip text-colorTextSecondary"
                    }`}
                >
                    {state}
                </span>
            </div>
            {input != null ? <Block label="input" value={formatToolValue(input)} /> : null}
            {errorText !== undefined ? (
                <Block label="error" value={stripFence(errorText)} danger />
            ) : output != null ? (
                <Block label="output" value={formatToolValue(output)} />
            ) : null}
        </div>
    )
}

const AssistantPart = ({part}: {part: UIMessage["parts"][number]}) => {
    const type = part.type as string
    if (type === "reasoning") {
        const text = (part as {text?: string}).text ?? ""
        if (!text.trim()) return null
        return (
            <Row label="Thought" copyText={text}>
                <div className="ag-surface-inset whitespace-pre-wrap rounded px-2.5 py-2 text-xs italic text-colorTextTertiary">
                    {text}
                </div>
            </Row>
        )
    }
    if (type === "text") {
        const text = (part as {text?: string}).text ?? ""
        if (!text.trim()) return null
        return (
            <Row label="Response" copyText={text}>
                <div className="whitespace-pre-wrap text-xs text-colorText">{text}</div>
            </Row>
        )
    }
    if (isToolPart(type)) return <ToolStep part={part as ToolUIPart} />
    // Drop step boundary markers and data-carrier/unknown parts (e.g. data-committed-revision,
    // data-trace): no renderable content, and empty rows only add noise to the timeline.
    return null
}

/**
 * The Timeline tab: the whole round — the user message that started the turn, then every step the
 * agent took (reasoning, tool calls with I/O, responses), in order. Reads the live message parts.
 */
const TimelineTab = ({round}: {round: UIMessage[]}) => {
    if (round.length === 0) {
        return <div className="text-xs text-colorTextTertiary">No turn selected.</div>
    }
    const nodes: ReactNode[] = []
    round.forEach((msg) => {
        if (msg.role === "user") {
            nodes.push(
                <Row key={msg.id} label="You" accent copyText={userText(msg) || undefined}>
                    <div className="ag-surface-inset whitespace-pre-wrap rounded px-2.5 py-2 text-xs text-colorText">
                        {userText(msg) || "—"}
                    </div>
                </Row>,
            )
            return
        }
        ;(msg.parts ?? []).forEach((part, i) => {
            nodes.push(<AssistantPart key={`${msg.id}-${i}`} part={part} />)
        })
    })
    return <div className="flex flex-col gap-3">{nodes}</div>
}

export default memo(TimelineTab)
