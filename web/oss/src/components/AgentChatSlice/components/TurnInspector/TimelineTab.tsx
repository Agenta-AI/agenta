import {memo} from "react"

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

const Block = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre
            className={`m-0 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug ${
                danger
                    ? "bg-[var(--ant-color-error-bg)] !text-colorErrorText"
                    : "bg-colorFillTertiary text-colorTextSecondary"
            }`}
        >
            {value}
        </pre>
    </div>
)

const PartNode = ({part}: {part: UIMessage["parts"][number]}) => {
    const type = part.type as string
    if (type === "reasoning") {
        const text = (part as {text?: string}).text ?? ""
        return (
            <div className="flex flex-col gap-1">
                <Text type="secondary" className="!text-[11px] font-medium">
                    reasoning
                </Text>
                <div className="text-xs italic text-colorTextTertiary whitespace-pre-wrap">
                    {text}
                </div>
            </div>
        )
    }
    if (type === "text") {
        const text = (part as {text?: string}).text ?? ""
        if (!text.trim()) return null
        return (
            <div className="flex flex-col gap-1">
                <Text type="secondary" className="!text-[11px] font-medium">
                    text
                </Text>
                <div className="text-xs text-colorText whitespace-pre-wrap">{text}</div>
            </div>
        )
    }
    if (isToolPart(type)) {
        const p = part as ToolUIPart
        const state = p.state as string
        const input = (p as {input?: unknown}).input
        const output = (p as {output?: unknown}).output
        const errorText = (p as {errorText?: string}).errorText
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                    <Text className="!text-xs !font-medium font-mono">{toolName(p)}</Text>
                    <Text
                        type={state === "output-error" ? "danger" : "secondary"}
                        className="!text-[11px]"
                    >
                        {state}
                    </Text>
                </div>
                {input != null ? <Block label="input" value={format(input)} /> : null}
                {errorText !== undefined ? (
                    <Block label="error" value={errorText} danger />
                ) : output != null ? (
                    <Block label="output" value={format(output)} />
                ) : null}
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-1">
            <Text type="secondary" className="!text-[11px] font-medium">
                {type}
            </Text>
        </div>
    )
}

/** The Timeline tab: every part of one assistant turn, in order, un-truncated. */
const TimelineTab = ({message}: {message: UIMessage | null}) => {
    if (!message) {
        return <div className="p-4 text-xs text-colorTextTertiary">No turn selected.</div>
    }
    const parts = message.parts ?? []
    return (
        <div className="flex flex-col gap-4 p-4">
            {parts.length === 0 ? (
                <div className="text-xs text-colorTextTertiary">This turn produced no parts.</div>
            ) : (
                parts.map((part, i) => (
                    <div
                        key={`${message.id}-${i}`}
                        className="border-0 border-l-2 border-solid border-colorBorderSecondary pl-3"
                    >
                        <PartNode part={part} />
                    </div>
                ))
            )}
        </div>
    )
}

export default memo(TimelineTab)
