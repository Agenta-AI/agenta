import type {FileUIPart, ToolUIPart, UIMessage} from "ai"

import {fileKind, filePartName} from "./files"

/**
 * Track B adapter — the cost of keeping the request contract aligned with Agenta's
 * existing services.
 *
 * `useChat` owns the conversation as `UIMessage[]` (typed parts). The existing Agenta
 * runtime (`chat.py`, `completion.py`, the execution-item builder) speaks OpenAI/ACP-style
 * `{role, content}` messages with `tool_calls` / `tool` result messages — NOT AI SDK parts.
 * This function translates one into the other so the slice can POST the shape those
 * services already parse.
 *
 * Two things the Agenta message contract has no native slot for, and what we do with them:
 *   - **reasoning parts** → dropped (no reasoning field in `{role, content}`).
 *   - **approval decisions** → there is no per-tool-call approval field on the Agenta
 *     request, so the decision is surfaced out-of-band in `tool_approvals`. This is a
 *     net-new convention Track B has to propose; it is exactly the seam to evaluate.
 *
 * Track A (the other option) skips this file entirely: `useChat`'s default transport posts
 * the `UIMessage[]` verbatim, and the service is expected to speak parts.
 */

export interface AgentaToolCall {
    id: string
    type: "function"
    function: {name: string; arguments: string}
}

/**
 * OpenAI-style multimodal content parts. A message with attachments serializes `content`
 * as this array instead of a plain string (images → `image_url`, other files → `file` with
 * the bytes inline as a data URL). Like `tool_approvals`, the exact multimodal shape Track B
 * sends is a net-new convention to validate against the backend.
 */
export type AgentaContentPart =
    | {type: "text"; text: string}
    | {type: "image_url"; image_url: {url: string}}
    | {type: "file"; file: {filename: string; file_data: string}}

export interface AgentaMessage {
    role: string
    content: string | AgentaContentPart[]
    tool_calls?: AgentaToolCall[]
    tool_call_id?: string
    name?: string
}

export interface AgentaToolApproval {
    tool_call_id: string
    tool_name: string
    approved: boolean
    input?: unknown
}

export interface AgentaRequestMessages {
    messages: AgentaMessage[]
    tool_approvals: AgentaToolApproval[]
}

const toolName = (part: ToolUIPart) => part.type.replace(/^tool-/, "")

const textOf = (message: UIMessage): string =>
    message.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join("")

const filePartToContent = (part: FileUIPart): AgentaContentPart =>
    fileKind(part.mediaType) === "image"
        ? {type: "image_url", image_url: {url: part.url}}
        : {type: "file", file: {filename: filePartName(part), file_data: part.url}}

/**
 * Message content for the Agenta request: a plain string when there are no attachments
 * (the common case), or an OpenAI-style multimodal parts array when the message carries
 * `file` parts (text first, then one entry per attachment).
 */
const contentOf = (message: UIMessage): string | AgentaContentPart[] => {
    const files = message.parts.filter((p) => p.type === "file") as FileUIPart[]
    const text = textOf(message)
    if (files.length === 0) return text
    return [...(text ? [{type: "text" as const, text}] : []), ...files.map(filePartToContent)]
}

/** Convert the `useChat` `UIMessage[]` into the Agenta `{role, content}` request shape. */
export const toAgentaMessages = (uiMessages: UIMessage[]): AgentaRequestMessages => {
    const messages: AgentaMessage[] = []
    const toolApprovals: AgentaToolApproval[] = []

    for (const ui of uiMessages) {
        const toolParts = ui.parts.filter((p) => p.type.startsWith("tool-")) as ToolUIPart[]

        const toolCalls: AgentaToolCall[] = toolParts.map((tp) => ({
            id: tp.toolCallId,
            type: "function",
            function: {
                name: toolName(tp),
                arguments: JSON.stringify(tp.input ?? {}),
            },
        }))

        messages.push({
            role: ui.role,
            content: contentOf(ui),
            ...(toolCalls.length ? {tool_calls: toolCalls} : {}),
        })

        // Resolved tool calls become OpenAI-style `tool` result messages.
        for (const tp of toolParts) {
            if (tp.state === "output-available") {
                messages.push({
                    role: "tool",
                    tool_call_id: tp.toolCallId,
                    name: toolName(tp),
                    content: JSON.stringify(tp.output ?? null),
                })
            } else if (tp.state === "output-denied") {
                messages.push({
                    role: "tool",
                    tool_call_id: tp.toolCallId,
                    name: toolName(tp),
                    content: JSON.stringify({status: "denied"}),
                })
            }

            // Pending approval decision → out-of-band side channel.
            if (tp.state === "approval-responded") {
                const approval = (tp as {approval?: {approved?: boolean}}).approval
                toolApprovals.push({
                    tool_call_id: tp.toolCallId,
                    tool_name: toolName(tp),
                    approved: Boolean(approval?.approved),
                    input: tp.input,
                })
            }
        }
    }

    return {messages, tool_approvals: toolApprovals}
}
