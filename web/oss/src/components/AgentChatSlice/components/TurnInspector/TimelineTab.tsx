import {memo, type ReactNode} from "react"

import {CheckCircle, CircleNotch, Prohibit, Warning} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Typography} from "antd"

const {Text} = Typography

const isToolPart = (t: string) => t.startsWith("tool-") || t === "dynamic-tool"

const toolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

const format = (value: unknown): string => {
    if (value == null) return ""
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** Strip a surrounding markdown code fence — backends sometimes wrap an error in ```…```. */
const stripFence = (value: string): string => {
    const m = value.trim().match(/^```[\w-]*\n?([\s\S]*?)\n?```$/)
    return m ? m[1].trim() : value
}

const userText = (message: UIMessage): string =>
    (message.parts ?? [])
        .filter((p) => (p as {type?: string}).type === "text")
        .map((p) => (p as {text?: string}).text ?? "")
        .join("\n")
        .trim()

const Block = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre
            className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug ${
                danger
                    ? "bg-[var(--ant-color-error-bg)] !text-colorErrorText"
                    : "bg-colorBgContainer text-colorTextSecondary"
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
const Row = ({label, accent, children}: {label: string; accent?: boolean; children: ReactNode}) => (
    <div
        className={`flex flex-col gap-1 border-0 border-l-2 border-solid pl-3 ${
            accent ? "border-colorPrimary" : "border-colorBorderSecondary"
        }`}
    >
        <Text type="secondary" className="!text-[11px] font-medium">
            {label}
        </Text>
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
        <div className="flex flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2.5">
            <div className="flex min-w-0 items-center gap-2">
                <ToolStatus state={state} />
                <Text
                    className="!text-xs !font-medium font-mono min-w-0 truncate"
                    title={toolName(part)}
                >
                    {toolName(part)}
                </Text>
                <Text
                    type={state === "output-error" ? "danger" : "secondary"}
                    className="!text-[11px] ml-auto shrink-0"
                >
                    {state}
                </Text>
            </div>
            {input != null ? <Block label="input" value={format(input)} /> : null}
            {errorText !== undefined ? (
                <Block label="error" value={stripFence(errorText)} danger />
            ) : output != null ? (
                <Block label="output" value={format(output)} />
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
            <Row label="Thought">
                <div className="whitespace-pre-wrap text-xs italic text-colorTextTertiary">
                    {text}
                </div>
            </Row>
        )
    }
    if (type === "text") {
        const text = (part as {text?: string}).text ?? ""
        if (!text.trim()) return null
        return (
            <Row label="Response">
                <div className="whitespace-pre-wrap text-xs text-colorText">{text}</div>
            </Row>
        )
    }
    if (isToolPart(type)) return <ToolStep part={part as ToolUIPart} />
    // Drop the AI SDK step boundary markers — they carry no content.
    if (type === "step-start" || type === "step-end") return null
    return (
        <Row label={type}>
            <span />
        </Row>
    )
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
                <Row key={msg.id} label="You" accent>
                    <div className="whitespace-pre-wrap text-xs text-colorText">
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
