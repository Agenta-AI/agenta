import type {SimpleChatMessage, MessageContent, MessageContentPart} from "../types/chatMessage"

import {unwrapValue} from "./_internal/unwrap"

type TemplateFormat = "curly" | "fstring" | "jinja2"

interface EnhancedPromptLike {
    messages?: {value?: unknown} | unknown
    templateFormat?: {value?: unknown} | unknown
    template_format?: {value?: unknown} | unknown
    inputKeys?: {value?: unknown} | unknown
    input_keys?: {value?: unknown} | unknown
}

export function normalizeEnhancedMessages(configMessages: unknown[]): SimpleChatMessage[] {
    return (configMessages || []).map((message, index) => {
        const msg = (message || {}) as Record<string, unknown>
        const role = String(
            unwrapValue(msg.role as {value?: string} | string | undefined) || "user",
        )
        const rawContent = unwrapValue(msg.content as {value?: unknown} | unknown)

        let content: MessageContent
        if (Array.isArray(rawContent)) {
            content = rawContent.map((part) => {
                const node = (part || {}) as Record<string, unknown>
                if (node.type === "image_url") {
                    return node as unknown as MessageContentPart
                }
                const textSource = node.text as {value?: unknown} | string | undefined
                const text = String(unwrapValue(textSource) || "")
                return {type: "text" as const, text}
            })
        } else {
            content = (rawContent as MessageContent) || ""
        }

        const id = String(msg.__id || `config-msg-${index}`)
        return {id, role, content}
    })
}

export function extractPromptTemplateContext(prompts: unknown[]): {
    templateFormat: TemplateFormat
    tokens: string[]
} {
    let templateFormat: TemplateFormat = "curly"
    let tokens: string[] = []

    for (const prompt of prompts || []) {
        const p = (prompt || {}) as EnhancedPromptLike
        const fmt =
            unwrapValue<unknown>(p.templateFormat) || unwrapValue<unknown>(p.template_format)
        if (typeof fmt === "string" && (fmt === "curly" || fmt === "fstring" || fmt === "jinja2")) {
            templateFormat = fmt
            break
        }
    }

    for (const prompt of prompts || []) {
        const p = (prompt || {}) as EnhancedPromptLike
        const keys = unwrapValue<unknown>(p.inputKeys) || unwrapValue<unknown>(p.input_keys)
        if (Array.isArray(keys)) {
            tokens = keys.filter((k): k is string => typeof k === "string")
            break
        }
    }

    return {templateFormat, tokens}
}
