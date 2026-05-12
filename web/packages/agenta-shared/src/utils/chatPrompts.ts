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

/** Extract variable names from template strings (e.g., "Hello {{name}}" → ["name"]) */
function extractVariablesFromText(text: string, format: TemplateFormat): string[] {
    const patterns: Record<TemplateFormat, RegExp> = {
        curly: /\{\{(\w+)\}\}/g,
        fstring: /\{(\w+)\}/g,
        jinja2: /\{\{(\w+)\}\}/g,
    }
    const regex = patterns[format]
    const vars = new Set<string>()
    let match
    while ((match = regex.exec(text)) !== null) {
        vars.add(match[1])
    }
    return Array.from(vars)
}

/** Collect all text from messages for variable extraction */
function collectMessageTexts(messages: unknown[]): string[] {
    const texts: string[] = []
    for (const msg of messages || []) {
        if (!msg || typeof msg !== "object") continue
        const m = msg as Record<string, unknown>
        const rawContent = unwrapValue(m.content as {value?: unknown} | unknown)
        if (typeof rawContent === "string") {
            texts.push(rawContent)
        } else if (Array.isArray(rawContent)) {
            for (const part of rawContent) {
                if (!part || typeof part !== "object") continue
                const node = part as Record<string, unknown>
                const textSource = node.text as {value?: unknown} | string | undefined
                const text = unwrapValue(textSource)
                if (typeof text === "string") texts.push(text)
            }
        }
    }
    return texts
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

    // Fallback: scan message content for template variables when inputKeys is absent
    if (tokens.length === 0) {
        const allMessages = (prompts || []).flatMap((prompt) => {
            const p = (prompt || {}) as Record<string, unknown>
            const msgs = p.messages
            return Array.isArray(msgs)
                ? msgs
                : Array.isArray(unwrapValue(msgs))
                  ? (unwrapValue(msgs) as unknown[])
                  : []
        })
        const texts = collectMessageTexts(allMessages)
        const vars = new Set<string>()
        for (const text of texts) {
            for (const v of extractVariablesFromText(text, templateFormat)) {
                vars.add(v)
            }
        }
        tokens = Array.from(vars)
    }

    return {templateFormat, tokens}
}
