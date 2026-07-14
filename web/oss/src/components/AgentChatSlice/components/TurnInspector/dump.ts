/**
 * Markdown dumps of the Turn Inspector tabs — agent-pasteable bug reports: prose stays prose,
 * code/data goes in fenced blocks. Downloaded via the tab bar's download icon.
 */
import {type TurnRequestCapture} from "@agenta/playground"
import type {ToolUIPart, UIMessage} from "ai"

import {mdFence as fence, mdHeader as header, mdJson as json} from "@/oss/lib/helpers/markdownDump"

import {formatToolValue, stripFence} from "../../assets/toolFormat"

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

export const timelineMarkdown = (round: UIMessage[], sessionId: string): string => {
    const parts: string[] = [header("Turn timeline", sessionId)]
    round.forEach((msg) => {
        if (msg.role === "user") {
            parts.push(`## User\n\n${userText(msg) || "—"}`)
            return
        }
        ;(msg.parts ?? []).forEach((part) => {
            const type = part.type as string
            if (type === "reasoning") {
                const text = (part as {text?: string}).text ?? ""
                if (text.trim()) parts.push(`## Thought\n\n${text}`)
            } else if (type === "text") {
                const text = (part as {text?: string}).text ?? ""
                if (text.trim()) parts.push(`## Response\n\n${text}`)
            } else if (isToolPart(type)) {
                const tool = part as ToolUIPart
                const state = tool.state as string
                const input = (tool as {input?: unknown}).input
                const output = (tool as {output?: unknown}).output
                const errorText = (tool as {errorText?: string}).errorText
                const sections = [`## Tool: ${toolName(tool)} (${state})`]
                if (input != null) sections.push(`input:\n\n${fence(formatToolValue(input))}`)
                if (errorText !== undefined) {
                    sections.push(`error:\n\n${fence(stripFence(errorText))}`)
                } else if (output != null) {
                    sections.push(`output:\n\n${fence(formatToolValue(output))}`)
                }
                parts.push(sections.join("\n\n"))
            }
        })
    })
    return parts.join("\n\n") + "\n"
}

const agentInstructions = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {instructions?: {agents_md?: unknown}}} | null
    const md = p?.agent?.instructions?.agents_md
    return typeof md === "string" ? md : null
}

const agentModel = (parameters: unknown): string | null => {
    const p = parameters as {agent?: {llm?: {model?: unknown}; model?: unknown}} | null
    const m = p?.agent?.llm?.model ?? p?.agent?.model
    return typeof m === "string" ? m : null
}

export const contextMarkdown = (captures: TurnRequestCapture[], sessionId: string): string => {
    const parts: string[] = [header("Turn context", sessionId)]
    if (captures.length === 0) parts.push("_No capture for this turn._")
    captures.forEach((c, i) => {
        const model = agentModel(c.parameters)
        const instructions = agentInstructions(c.parameters)
        const sections = [`## Request ${i + 1} of ${captures.length}${model ? ` — ${model}` : ""}`]
        if (instructions != null)
            sections.push(`instructions (agents_md):\n\n${fence(instructions, "md")}`)
        sections.push(`parameters (config as sent):\n\n${fence(json(c.parameters), "json")}`)
        sections.push(
            `messages sent (${(c.messages ?? []).length}):\n\n${fence(json(c.messages), "json")}`,
        )
        parts.push(sections.join("\n\n"))
    })
    return parts.join("\n\n") + "\n"
}

/** The literal outgoing request body — must mirror RawTab's reconstruction. */
export const captureRequestBody = (c: TurnRequestCapture) => ({
    session_id: c.sessionId,
    references: c.references,
    data: {inputs: {messages: c.messages}, parameters: c.parameters},
})

export const rawMarkdown = (captures: TurnRequestCapture[], sessionId: string): string => {
    const parts: string[] = [header("Turn raw requests", sessionId)]
    if (captures.length === 0) parts.push("_No capture for this turn._")
    captures.forEach((c, i) => {
        parts.push(
            [
                `## Request ${i + 1} of ${captures.length}`,
                `POST \`${c.invocationUrl}\``,
                fence(json(captureRequestBody(c)), "json"),
            ].join("\n\n"),
        )
    })
    return parts.join("\n\n") + "\n"
}
