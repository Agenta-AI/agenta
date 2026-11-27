/**
 * The shape of a stored value: one name per way the evaluation views draw it (a table cell, a
 * field in a panel, a full view). The names and the order of the checks are the data shape
 * taxonomy of the evaluation views; the first check that matches wins.
 *
 * @packageDocumentation
 */

import type {MessageContent} from "../types/chatMessage"

import {getAttachments, isChatMessageObject, isChatMessagesArray} from "./chatMessage"
import {isUrl} from "./dataUri"
import {parseStructuredJson} from "./jsonParsing"

/**
 * The shapes in the order they are checked. JSON written as text has no name of its own: it
 * takes the shape of the parsed value, with `parsedFromText`.
 */
export type ValueShape =
    | "empty"
    | "boolean"
    | "number"
    | "url"
    | "markdown"
    | "text-long"
    | "text-short"
    | "messages"
    | "array-scalars"
    | "array-objects"
    | "message"
    | "object-flat"
    /** An object with a nested value, or an array that is none of the array shapes above. */
    | "object-nested"

export interface DetectedValue {
    shape: ValueShape
    /** What to draw: the parsed value of JSON text, the messages under `key`, else the input. */
    value: unknown
    /** The wrapper key the messages were found under (`messages`, `choices`, ...). */
    key?: string
    /** The input was a string that holds JSON (also inside a code fence). */
    parsedFromText?: boolean
}

/** Over this many lines, plain text is `text-long`. */
export const TEXT_LONG_LINES = 12
/** Over this many characters, plain text is `text-long`. */
export const TEXT_LONG_CHARS = 1500

/** Keys whose value is a chat when it is the object's only key. */
const MESSAGE_KEYS = [
    "messages",
    "prompt",
    "completion",
    "input_messages",
    "output_messages",
    "responses",
    "message_history",
    "history",
    "chat",
    "conversation",
] as const

const MARKDOWN_PATTERNS = [
    /^#{1,6}\s+\S/m, // heading
    // `[^\S\n\r\u2028\u2029]` is `\s` without line breaks: `^\s*` crossed blank lines and made
    // this check quadratic on text with many of them.
    /^[^\S\n\r\u2028\u2029]*(?:[-*+]|\d+[.)])\s+\S/m, // list item
    /^>\s?\S/m, // quote
    /^```/m, // code fence
    /^\|.+\|\s*$/m, // table row
    /\*\*[^*\n]+\*\*/, // bold
]

const WHITESPACE = /\s/

/**
 * True when the text holds a link `[label](url)`: what `/\[[^\]\n]+\]\([^)\s]+\)/` matches, in one
 * pass. The pattern rescans the rest of the text from every `[` (and every `](`), which is
 * quadratic on text such as a long run of `[`.
 */
const hasMarkdownLink = (text: string): boolean => {
    // The first `[` since the last `]` or line break: the longest label a `]` can close.
    let open = -1
    // Every `](` before this index has no valid destination: they all end at the same space.
    let noDestinationBefore = 0
    for (let index = 0; index < text.length; index++) {
        const char = text[index]
        if (char === "\n") open = -1
        else if (char === "[") {
            if (open === -1) open = index
        } else if (char === "]") {
            if (
                open !== -1 &&
                index - open >= 2 &&
                text[index + 1] === "(" &&
                index >= noDestinationBefore
            ) {
                let end = index + 2
                while (end < text.length && text[end] !== ")" && !WHITESPACE.test(text[end])) end++
                if (end > index + 2 && text[end] === ")") return true
                noDestinationBefore = end
            }
            open = -1
        }
    }
    return false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const isScalar = (value: unknown) =>
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"

/** The number of lines of a text. */
export const lineCount = (text: string): number => {
    let count = 1
    for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
        count += 1
    }
    return count
}

/** True when the text uses markdown syntax: a heading, a list, a quote, a fence, a table, bold or a link. */
export const hasMarkdownSyntax = (text: string): boolean =>
    MARKDOWN_PATTERNS.some((pattern) => pattern.test(text)) || hasMarkdownLink(text)

/** Only text that starts like an object, an array, a fence or a quoted string can hold JSON. */
const mayHoldJson = (text: string) => {
    const first = text.trimStart().charAt(0)
    return first === "{" || first === "[" || first === "`" || first === '"'
}

/** The messages of `{choices: [{message}, ...]}`. */
const choiceMessages = (choices: unknown): unknown[] | null => {
    if (!Array.isArray(choices)) return null
    const messages = choices
        .map((choice) => (isRecord(choice) ? (choice.message ?? choice.delta) : undefined))
        .filter((message) => message !== undefined)
    return messages.length > 0 && isChatMessagesArray(messages) ? messages : null
}

/** Messages under the only key of an object: `{messages: [...]}`, `{choices: [{message}]}`. */
const wrappedMessages = (
    value: Record<string, unknown>,
): {key: string; value: unknown[]} | null => {
    const keys = Object.keys(value)
    if (keys.length !== 1) return null
    const key = keys[0]
    if (key === "choices") {
        const messages = choiceMessages(value.choices)
        return messages ? {key, value: messages} : null
    }
    const inner = value[key]
    if ((MESSAGE_KEYS as readonly string[]).includes(key) && isChatMessagesArray(inner)) {
        return {key, value: inner}
    }
    return null
}

const detectText = (text: string): DetectedValue => {
    if (isUrl(text.trim()) && !/\s/.test(text.trim())) return {shape: "url", value: text}
    if (mayHoldJson(text)) {
        const parsed = parseStructuredJson(text)
        if (parsed !== null) return {...detectStructured(parsed as object), parsedFromText: true}
    }
    if (hasMarkdownSyntax(text)) return {shape: "markdown", value: text}
    if (text.length > TEXT_LONG_CHARS || lineCount(text) > TEXT_LONG_LINES) {
        return {shape: "text-long", value: text}
    }
    return {shape: "text-short", value: text}
}

/** An array, or an object that is not an array (`typeof value === "object"`, not null). */
const detectStructured = (value: object): DetectedValue => {
    if (Array.isArray(value)) {
        if (value.length === 0) return {shape: "empty", value}
        if (isChatMessagesArray(value)) return {shape: "messages", value}
        if (value.every(isScalar)) return {shape: "array-scalars", value}
        if (value.every(isRecord)) return {shape: "array-objects", value}
        return {shape: "object-nested", value}
    }
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (keys.length === 0) return {shape: "empty", value}
    if (isChatMessageObject(record)) return {shape: "message", value}
    const wrapped = wrappedMessages(record)
    if (wrapped) return {shape: "messages", value: wrapped.value, key: wrapped.key}
    return keys.every((key) => isScalar(record[key]))
        ? {shape: "object-flat", value}
        : {shape: "object-nested", value}
}

/**
 * Name the shape of a stored value. The checks run in the taxonomy order: empty; boolean,
 * number; for a string, url, JSON text (the shape of the parsed value), markdown, long text,
 * short text; for an array, messages, scalars, objects, else nested; for an object, one
 * message, messages under a known key, flat, else nested.
 *
 * The caller keeps the original value for a Raw view.
 */
export function detectValueShape(value: unknown): DetectedValue {
    if (value === undefined || value === null || value === "") return {shape: "empty", value}
    if (typeof value === "boolean") return {shape: "boolean", value}
    if (typeof value === "number" || typeof value === "bigint") return {shape: "number", value}
    if (typeof value === "string") return detectText(value)
    if (typeof value === "object") return detectStructured(value)
    return {shape: "text-short", value: String(value)}
}

/**
 * A number as the value views print it: an integer as it is, a decimal with at most three
 * significant digits after the point ("0.875", "0.000123", "4218.4").
 */
export function formatShapeNumber(value: number | bigint): string {
    if (typeof value === "bigint" || Number.isInteger(value) || !Number.isFinite(value)) {
        return String(value)
    }
    const magnitude = Math.floor(Math.log10(Math.abs(value)))
    const decimals = magnitude < 0 ? 2 - magnitude : 3
    return String(Number(value.toFixed(Math.min(decimals, 20))))
}

/** The parts of one stored chat message that the value views draw. */
export interface ValueMessage {
    role: string
    text: string
    /** Calls of an assistant message: its id, the tool name and the arguments as stored. */
    toolCalls: {id: string | null; name: string; arguments: unknown}[]
    /** The call a `tool` message answers. */
    toolCallId: string | null
    /** The tool name of a `tool` message, when the message names it. */
    toolName: string | null
    attachments: ReturnType<typeof getAttachments>
}

const partText = (part: unknown): string => {
    if (typeof part === "string") return part
    if (!isRecord(part)) return ""
    return part.type === "text" && typeof part.text === "string" ? part.text : ""
}

/** Read one chat message, in any of the shapes `isChatMessageObject` accepts. */
export function readValueMessage(message: unknown): ValueMessage {
    const record = isRecord(message) ? message : {}
    const actor = record.role ?? record.sender ?? record.author
    const content = record.content ?? record.text ?? record.message ?? record.parts
    const text =
        typeof content === "string"
            ? content
            : Array.isArray(content)
              ? content.map(partText).filter(Boolean).join("\n")
              : typeof (record.delta as Record<string, unknown> | undefined)?.content === "string"
                ? ((record.delta as Record<string, unknown>).content as string)
                : ""
    const calls = Array.isArray(record.tool_calls)
        ? record.tool_calls
        : isRecord(record.function_call)
          ? [{function: record.function_call}]
          : []
    return {
        role: typeof actor === "string" ? actor : "",
        text,
        toolCalls: calls.filter(isRecord).map((call) => {
            const fn = isRecord(call.function) ? call.function : call
            return {
                id: typeof call.id === "string" ? call.id : null,
                name: typeof fn.name === "string" ? fn.name : "",
                arguments: fn.arguments ?? fn.input ?? null,
            }
        }),
        toolCallId: typeof record.tool_call_id === "string" ? record.tool_call_id : null,
        toolName: typeof record.name === "string" ? record.name : null,
        attachments: Array.isArray(content) ? getAttachments(content as MessageContent) : [],
    }
}
