import {ReactNode} from "react"

import {renderChatMessages} from "@/oss/components/EvalRunDetails2/utils/renderChatMessages"

type ChatPayload = {role?: string; sender?: string; author?: string; content?: any; text?: any}

const CHAT_ARRAY_KEYS = [
    "messages",
    "message_history",
    "history",
    "chat",
    "conversation",
    "logs",
    "responses",
    "output_messages",
]

const tryParseJson = (value: unknown): unknown => {
    if (typeof value !== "string") return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

const isChatEntry = (entry: any): boolean => {
    if (!entry || typeof entry !== "object") return false
    if (
        typeof entry.role === "string" ||
        typeof entry.sender === "string" ||
        typeof entry.author === "string"
    ) {
        return (
            entry.content !== undefined ||
            entry.text !== undefined ||
            entry.message !== undefined ||
            Array.isArray(entry.content) ||
            Array.isArray(entry.parts) ||
            typeof entry.delta?.content === "string"
        )
    }
    return false
}

const extractMessageArray = (value: any): any[] | null => {
    if (!value) return null
    if (Array.isArray(value)) return value
    if (typeof value !== "object") return null

    for (const key of CHAT_ARRAY_KEYS) {
        if (Array.isArray((value as any)[key])) {
            return (value as any)[key]
        }
    }

    if (Array.isArray((value as any)?.choices)) {
        const messages = (value.choices as any[])
            .map((choice) => choice?.message || choice?.delta)
            .filter(Boolean)
        if (messages.length) return messages
    }

    if (isChatEntry(value)) {
        return [value]
    }

    return null
}

const normalizeMessages = (messages: any[]): {role: string; content: any}[] => {
    return messages
        .map((entry) => {
            if (!entry) return null
            if (typeof entry === "string") {
                return {role: "assistant", content: entry}
            }

            const role =
                (typeof entry.role === "string" && entry.role) ||
                (typeof entry.sender === "string" && entry.sender) ||
                (typeof entry.author === "string" && entry.author) ||
                "assistant"

            const content =
                entry.content ??
                entry.text ??
                entry.message ??
                entry.delta?.content ??
                entry.response ??
                (Array.isArray(entry.parts) ? entry.parts : undefined)

            if (content === undefined) {
                return null
            }

            return {role, content}
        })
        .filter((entry): entry is {role: string; content: any} => Boolean(entry?.content))
}

export const renderScenarioChatMessages = (
    value: unknown,
    keyPrefix: string,
): ReactNode[] | null => {
    const parsed = tryParseJson(value)
    const messageArray = extractMessageArray(parsed)
    if (!messageArray) return null

    const normalized = normalizeMessages(messageArray)
    if (!normalized.length) return null

    try {
        return renderChatMessages({
            keyPrefix,
            rawJson: JSON.stringify(normalized),
            view: "table",
        })
    } catch {
        return null
    }
}
