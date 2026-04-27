import {memo, useEffect, useLayoutEffect, useMemo} from "react"

import {
    Editor as EditorWrapper,
    EditorProvider,
    useLexicalComposerContext,
    SET_MARKDOWN_VIEW,
} from "@agenta/ui"
import {
    extractChatMessages,
    normalizeChatMessages,
    ROLE_COLOR_CLASSES,
    DEFAULT_ROLE_COLOR_CLASS,
} from "@agenta/ui/cell-renderers"

/**
 * "Beautified JSON" view.
 *
 * ## What this mode does
 *
 * Reshapes data for readability and renders it OUTSIDE the JSON editor as a
 * component tree:
 *
 * - chat-like arrays and single messages → chat bubbles (role label + content
 *   editor with markdown support)
 * - plain objects → per-key labeled variable fields (recursive; short leaves
 *   inline as `key: value`)
 * - known envelope patterns (AI SDK `{type: "text"|"tool-call"|"tool-result"}`)
 *   are unwrapped into their payload
 * - noisy provider-metadata keys (`providerOptions`, `rawHeaders`, `rawCall`,
 *   `rawResponse`, `logprobs`, etc.) are stripped from objects
 *
 * ## What this mode is NOT
 *
 * "Beautified JSON" is not JSON — it hides fields, restructures values, and
 * renders via custom React components. When the exact shape of the wire data
 * matters, use "JSON" (faithful) or "Decoded JSON" (faithful shape with
 * string decoding, see `decodedJsonHelpers.ts`).
 *
 * This mode is the default when `viewModePreset="message"`, because that
 * preset is used specifically for chat-style data where the reshape is
 * desirable. Everywhere else, "Decoded JSON" is the default.
 *
 * ## Authoritative reference
 *
 * `VIEW_MODES.md` in this folder documents every view mode and the rules
 * for choosing a default. Keep it in sync when you change behavior here.
 */

const METADATA_NOISE_KEYS = new Set([
    "providerOptions",
    "experimental_providerMetadata",
    "rawHeaders",
    "caller",
    "messageId",
    "toolCallId",
    "rawCall",
    "rawResponse",
    "logprobs",
])

const EDITOR_RESET_CLASSES =
    "!min-h-0 [&_.editor-inner]:!border-0 [&_.editor-inner]:!rounded-none [&_.editor-inner]:!min-h-0 [&_.editor-container]:!bg-transparent [&_.editor-container]:!min-h-0 [&_.editor-input]:!min-h-0 [&_.editor-input]:!px-0 [&_.editor-input]:!py-0 [&_.editor-paragraph]:!mb-1 [&_.editor-paragraph:last-child]:!mb-0 [&_.agenta-editor-wrapper]:!min-h-0"

const DEFAULT_MAX_RENDER_DEPTH = 5

/**
 * Simplify a value by unwrapping known envelope patterns.
 * Returns the simplified value, or the original if no simplification applies.
 */
const simplifyValue = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value

    const rec = value as Record<string, unknown>

    // AI SDK text part: {type: "text", text: "hello"} → "hello"
    if (rec.type === "text" && typeof rec.text === "string") {
        return rec.text
    }

    // AI SDK tool-call: {type: "tool-call", toolName: "fn", input: {...}} → "fn({...})"
    if (rec.type === "tool-call" && typeof rec.toolName === "string") {
        const args = rec.input ?? rec.args
        if (!args || (typeof args === "object" && Object.keys(args as object).length === 0)) {
            return `${rec.toolName}()`
        }
        try {
            return `${rec.toolName}(${JSON.stringify(args, null, 2)})`
        } catch {
            return `${rec.toolName}(...)`
        }
    }

    // AI SDK tool-result envelope: {type: "tool-result", output: {type: "json", value: X}} → X
    if (rec.type === "tool-result" && rec.output !== undefined) {
        const output = rec.output as Record<string, unknown> | undefined
        if (output && typeof output === "object" && output.value !== undefined) {
            return output.value
        }
        return rec.output
    }

    // Single-element array of a simplifiable item
    if (Array.isArray(value) && value.length === 1) {
        const simplified = simplifyValue(value[0])
        if (simplified !== value[0]) return simplified
    }

    // Multi-element array: simplify each element
    if (Array.isArray(value) && value.length > 1) {
        const simplified = value.map(simplifyValue)
        const changed = simplified.some((s, i) => s !== value[i])
        if (changed) {
            if (simplified.every((s) => typeof s === "string")) {
                return (simplified as string[]).join("\n")
            }
            return simplified
        }
    }

    // Strip metadata noise keys from objects
    if (!Array.isArray(value)) {
        const keys = Object.keys(rec)
        const noiseKeys = keys.filter((k) => METADATA_NOISE_KEYS.has(k))
        if (noiseKeys.length > 0 && noiseKeys.length < keys.length) {
            const cleaned: Record<string, unknown> = {}
            for (const k of keys) {
                if (!METADATA_NOISE_KEYS.has(k)) {
                    cleaned[k] = rec[k]
                }
            }
            const cleanedKeys = Object.keys(cleaned)
            if (cleanedKeys.length === 1) {
                return cleaned[cleanedKeys[0]]
            }
            return cleaned
        }
    }

    return value
}

const formatLabel = (key: string): string =>
    key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())

const isShortLeaf = (value: unknown): boolean => {
    if (value === null || value === undefined) return true
    if (typeof value === "boolean" || typeof value === "number") return true
    if (typeof value === "string" && value.length <= 120 && !value.includes("\n")) return true
    return false
}

const InlineKeyValue = memo(function InlineKeyValue({
    label,
    value,
}: {
    label: string
    value: string
}) {
    return (
        <div className="flex items-baseline gap-2 min-h-[20px]">
            <span className="text-xs text-[var(--ant-color-text-tertiary)] shrink-0">{label}</span>
            <span className="font-mono text-[var(--ant-color-text)] break-all">{value || "—"}</span>
        </div>
    )
})

const MarkdownModeSync = ({isMarkdownView}: {isMarkdownView: boolean}) => {
    const [editor] = useLexicalComposerContext()

    useLayoutEffect(() => {
        editor.dispatchCommand(SET_MARKDOWN_VIEW, isMarkdownView)
    }, [editor, isMarkdownView])

    useEffect(() => {
        const frameId = requestAnimationFrame(() => {
            editor.dispatchCommand(SET_MARKDOWN_VIEW, isMarkdownView)
        })
        return () => cancelAnimationFrame(frameId)
    }, [editor, isMarkdownView])

    return null
}

const getMessageText = (content: unknown): string => {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content

    if (content && typeof content === "object" && !Array.isArray(content)) {
        const rec = content as Record<string, unknown>
        if (rec.type === "text" && typeof rec.text === "string") return rec.text
        if (rec.type === "tool-call" && typeof rec.toolName === "string") {
            const args = rec.args ?? rec.input
            return args ? `${rec.toolName}(${JSON.stringify(args, null, 2)})` : String(rec.toolName)
        }
        if (rec.type === "tool-result") {
            const output = rec.output as Record<string, unknown> | undefined
            const value = output?.value ?? output ?? rec.result
            return typeof value === "string" ? value : JSON.stringify(value, null, 2)
        }
    }

    if (Array.isArray(content)) {
        const parts: string[] = []
        for (const c of content) {
            const rec = c as Record<string, unknown> | null
            if (!rec || typeof rec !== "object") {
                parts.push(String(c))
                continue
            }
            if (rec.type === "text" && typeof rec.text === "string") {
                parts.push(rec.text)
            } else if (rec.type === "tool-call" && typeof rec.toolName === "string") {
                parts.push(`[tool: ${rec.toolName}]`)
            } else if (rec.type === "tool-result") {
                const output = rec.output as Record<string, unknown> | undefined
                const value = output?.value ?? output ?? rec.result
                parts.push(typeof value === "string" ? value : JSON.stringify(value, null, 2))
            } else if (typeof rec.text === "string") {
                parts.push(rec.text)
            }
        }
        if (parts.length > 0) return parts.join("\n")
    }

    try {
        return JSON.stringify(content, null, 2)
    } catch {
        return String(content)
    }
}

const RenderedChatMessages = memo(function RenderedChatMessages({
    messages,
    keyPrefix,
}: {
    messages: unknown[]
    keyPrefix: string
}) {
    const normalized = useMemo(() => normalizeChatMessages(messages), [messages])

    return (
        <div className="flex flex-col gap-2">
            {normalized.map((msg, i) => {
                const roleColor =
                    ROLE_COLOR_CLASSES[msg.role.toLowerCase()] ?? DEFAULT_ROLE_COLOR_CLASS
                const text = getMessageText(msg.content)
                const editorId = `${keyPrefix}-msg-${i}`

                return (
                    <div key={editorId} className="flex flex-col gap-0.5">
                        <span className={`text-xs font-medium capitalize ${roleColor}`}>
                            {msg.role}
                        </span>
                        <EditorProvider
                            id={editorId}
                            initialValue={text}
                            showToolbar={false}
                            enableTokens={false}
                            readOnly
                            className={EDITOR_RESET_CLASSES}
                        >
                            <MarkdownModeSync isMarkdownView={false} />
                            <EditorWrapper
                                initialValue={text}
                                disabled
                                showToolbar={false}
                                noProvider
                                readOnly
                                boundHeight={false}
                            />
                        </EditorProvider>
                    </div>
                )
            })}
        </div>
    )
})

const valueToString = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

const ReadOnlyVariableField = memo(function ReadOnlyVariableField({
    label,
    value,
    editorId,
}: {
    label: string
    value: string
    editorId: string
}) {
    return (
        <EditorProvider
            id={editorId}
            initialValue={value}
            showToolbar={false}
            enableTokens={false}
            readOnly
            className={EDITOR_RESET_CLASSES}
        >
            <MarkdownModeSync isMarkdownView={false} />
            <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--ant-color-text-tertiary)]">
                    {label}
                </span>
                <EditorWrapper
                    initialValue={value}
                    disabled
                    showToolbar={false}
                    noProvider
                    readOnly
                    boundHeight={false}
                />
            </div>
        </EditorProvider>
    )
})

const RenderedValueBlock = memo(function RenderedValueBlock({
    value: rawValue,
    keyPrefix,
    depth = 0,
    maxDepth = DEFAULT_MAX_RENDER_DEPTH,
}: {
    value: unknown
    keyPrefix: string
    depth?: number
    maxDepth?: number
}) {
    const value = useMemo(() => simplifyValue(rawValue), [rawValue])

    const chatMessages = useMemo(() => extractChatMessages(value), [value])

    if (chatMessages && chatMessages.length > 0) {
        return <RenderedChatMessages messages={chatMessages} keyPrefix={keyPrefix} />
    }

    if (value === null || value === undefined) {
        return <span className="text-[#758391]">—</span>
    }

    if (typeof value === "string") {
        return (
            <EditorProvider
                id={keyPrefix}
                initialValue={value}
                showToolbar={false}
                enableTokens={false}
                readOnly
                className={EDITOR_RESET_CLASSES}
            >
                <MarkdownModeSync isMarkdownView={false} />
                <EditorWrapper
                    initialValue={value}
                    disabled
                    showToolbar={false}
                    noProvider
                    readOnly
                    boundHeight={false}
                />
            </EditorProvider>
        )
    }

    if (Array.isArray(value) && value.length === 0) {
        return <span className="text-[#758391]">—</span>
    }

    if (
        depth < maxDepth &&
        Array.isArray(value) &&
        value.length > 0 &&
        value.some((item) => item && typeof item === "object")
    ) {
        return (
            <div className="flex flex-col gap-2">
                {value.map((item, i) => {
                    const simplified = simplifyValue(item)
                    if (
                        typeof simplified === "string" ||
                        typeof simplified === "number" ||
                        typeof simplified === "boolean"
                    ) {
                        return (
                            <ReadOnlyVariableField
                                key={i}
                                label={`${i + 1}`}
                                value={String(simplified)}
                                editorId={`${keyPrefix}-${i}`}
                            />
                        )
                    }
                    if (simplified && typeof simplified === "object") {
                        return (
                            <div key={i} className="flex flex-col gap-1">
                                <div className="pl-3">
                                    <RenderedValueBlock
                                        value={simplified}
                                        keyPrefix={`${keyPrefix}-${i}`}
                                        depth={depth + 1}
                                        maxDepth={maxDepth}
                                    />
                                </div>
                            </div>
                        )
                    }
                    return (
                        <ReadOnlyVariableField
                            key={i}
                            label={`${i + 1}`}
                            value={valueToString(simplified)}
                            editorId={`${keyPrefix}-${i}`}
                        />
                    )
                })}
            </div>
        )
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>)
        return (
            <div className="flex flex-col gap-1">
                {entries.map(([k, v]) => {
                    const simplified = simplifyValue(v)
                    const nestedChat = extractChatMessages(simplified)
                    if (nestedChat && nestedChat.length > 0) {
                        return (
                            <div key={k} className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-[var(--ant-color-text-tertiary)]">
                                    {formatLabel(k)}
                                </span>
                                <RenderedChatMessages
                                    messages={nestedChat}
                                    keyPrefix={`${keyPrefix}-${k}`}
                                />
                            </div>
                        )
                    }

                    if (isShortLeaf(simplified)) {
                        return (
                            <InlineKeyValue
                                key={k}
                                label={formatLabel(k)}
                                value={
                                    simplified === null || simplified === undefined
                                        ? "—"
                                        : String(simplified)
                                }
                            />
                        )
                    }

                    if (depth < maxDepth && simplified && typeof simplified === "object") {
                        return (
                            <div key={k} className="flex flex-col gap-0.5 mt-1">
                                <span className="text-xs font-medium text-[var(--ant-color-text-tertiary)]">
                                    {formatLabel(k)}
                                </span>
                                <div className="pl-3">
                                    <RenderedValueBlock
                                        value={simplified}
                                        keyPrefix={`${keyPrefix}-${k}`}
                                        depth={depth + 1}
                                        maxDepth={maxDepth}
                                    />
                                </div>
                            </div>
                        )
                    }

                    return (
                        <ReadOnlyVariableField
                            key={k}
                            label={formatLabel(k)}
                            value={valueToString(simplified)}
                            editorId={`${keyPrefix}-${k}`}
                        />
                    )
                })}
            </div>
        )
    }

    return (
        <EditorProvider
            id={keyPrefix}
            initialValue={valueToString(value)}
            showToolbar={false}
            enableTokens={false}
            readOnly
            className={EDITOR_RESET_CLASSES}
        >
            <MarkdownModeSync isMarkdownView={false} />
            <EditorWrapper
                initialValue={valueToString(value)}
                disabled
                showToolbar={false}
                noProvider
                readOnly
                boundHeight={false}
            />
        </EditorProvider>
    )
})

/**
 * Beautified JSON view: renders a value as per-key fields or chat messages
 * (opt-in display mode; do not use as the default when faithful JSON is
 * required — use the JSON code viewer for that).
 */
export const BeautifiedJsonView = memo(function BeautifiedJsonView({
    data: rawData,
    keyPrefix,
}: {
    data: unknown
    keyPrefix: string
}) {
    const data = useMemo(() => simplifyValue(rawData), [rawData])

    const isDirectChat = useMemo(() => {
        if (typeof data === "string") return false
        if (Array.isArray(data)) return !!extractChatMessages(data)
        if (data && typeof data === "object" && "role" in (data as Record<string, unknown>)) {
            return !!extractChatMessages(data)
        }
        return false
    }, [data])
    const directChatMessages = useMemo(
        () => (isDirectChat ? extractChatMessages(data) : null),
        [isDirectChat, data],
    )

    const entries = useMemo(() => {
        if (typeof data === "string") return null
        if (isDirectChat) return null
        if (!data || typeof data !== "object" || Array.isArray(data)) return null
        return Object.entries(data as Record<string, unknown>)
    }, [data, isDirectChat])

    if (typeof data === "string") {
        return (
            <div className="p-4">
                <RenderedValueBlock value={data} keyPrefix={keyPrefix} />
            </div>
        )
    }

    if (isDirectChat && directChatMessages && directChatMessages.length > 0) {
        return (
            <div className="p-4">
                <RenderedChatMessages messages={directChatMessages} keyPrefix={keyPrefix} />
            </div>
        )
    }

    if (entries) {
        return (
            <div className="flex flex-col gap-4 p-4">
                {entries.map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold text-[#758391]">{key}</span>
                        <RenderedValueBlock value={value} keyPrefix={`${keyPrefix}-${key}`} />
                    </div>
                ))}
            </div>
        )
    }

    return (
        <div className="p-4">
            <RenderedValueBlock value={data} keyPrefix={keyPrefix} />
        </div>
    )
})

BeautifiedJsonView.displayName = "BeautifiedJsonView"
