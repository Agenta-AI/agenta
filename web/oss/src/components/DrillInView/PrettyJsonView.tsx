import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {
    Editor as EditorWrapper,
    EditorProvider,
    useLexicalComposerContext,
    SET_MARKDOWN_VIEW,
} from "@agenta/ui"
import {
    isChatMessagesArray,
    normalizeChatMessages,
    ROLE_COLOR_CLASSES,
    DEFAULT_ROLE_COLOR_CLASS,
} from "@agenta/ui/cell-renderers"

/**
 * "Pretty JSON" view.
 *
 * Reshapes data for readability and renders it OUTSIDE the JSON editor as a
 * component tree:
 *
 * - chat-like arrays and single messages -> chat bubbles (role label + content
 *   editor with markdown support)
 * - plain objects -> per-key labeled fields with collapse/expand, count badges,
 *   indent guides, and hover-to-copy
 * - short leaf values (null, bool, number, short string) inline as
 *   `key: value` with type-colored values
 * - known envelope patterns (AI SDK `{type: "text"|"tool-call"|"tool-result"}`)
 *   are unwrapped into their payload
 * - noisy provider-metadata keys (`providerOptions`, `rawHeaders`, etc.) are
 *   stripped from objects
 *
 * "Pretty JSON" is not JSON -- it hides fields, restructures values, and
 * renders via custom React components. When the exact shape of the wire data
 * matters, use "JSON" (faithful) or "Decoded JSON" (faithful shape with
 * string decoding, see `decodedJsonHelpers.ts`).
 */

// Keep in sync with MESSAGE_KEY_HINTS in messagePanels.ts
const CHAT_ARRAY_KEYS = new Set([
    "prompt",
    "input_messages",
    "completion",
    "output_messages",
    "responses",
    "messages",
    "message_history",
    "history",
    "chat",
    "conversation",
    "logs",
])

// Matches isChatEntry in @agenta/ui/cell-renderers — accept the same role
// aliases (sender, author) and content aliases (text, message, parts, etc.)
const isSingleMessage = (value: unknown): boolean => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false
    const obj = value as Record<string, unknown>
    const hasRole =
        typeof obj.role === "string" ||
        typeof obj.sender === "string" ||
        typeof obj.author === "string"
    if (!hasRole) return false
    return (
        obj.content !== undefined ||
        obj.text !== undefined ||
        obj.message !== undefined ||
        Array.isArray(obj.content) ||
        Array.isArray(obj.parts) ||
        Array.isArray(obj.tool_calls) ||
        typeof (obj.delta as Record<string, unknown>)?.content === "string"
    )
}

const shallowExtractChatMessages = (
    value: unknown,
): {messages: unknown[]; viaKey?: string} | null => {
    if (Array.isArray(value) && isChatMessagesArray(value)) {
        return {messages: value}
    }
    if (isSingleMessage(value)) {
        return {messages: [value]}
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>
        for (const key of CHAT_ARRAY_KEYS) {
            const arr = obj[key]
            if (Array.isArray(arr) && isChatMessagesArray(arr)) {
                return {messages: arr, viaKey: key}
            }
        }
        // OpenAI choices format: {choices: [{message: {role, content}}, ...]}
        if (Array.isArray(obj.choices)) {
            const extracted = (obj.choices as Record<string, unknown>[])
                .map((c) => c?.message ?? c?.delta)
                .filter(Boolean)
            if (extracted.length > 0 && isChatMessagesArray(extracted)) {
                return {messages: extracted, viaKey: "choices"}
            }
        }
    }
    return null
}

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

const EDITOR_RESET_CLASSES = [
    "!min-h-0",
    "[&_.editor-inner]:!border-0 [&_.editor-inner]:!rounded-none [&_.editor-inner]:!min-h-0",
    "[&_.editor-container]:!bg-transparent [&_.editor-container]:!min-h-0",
    "[&_.editor-input]:!min-h-0 [&_.editor-input]:!px-0 [&_.editor-input]:!py-0",
    "[&_.editor-paragraph]:!mb-1 [&_.editor-paragraph:last-child]:!mb-0",
    "[&_.agenta-editor-wrapper]:!min-h-0",
].join(" ")

// Allow deep trace payloads to keep expanding in pretty mode.
// Guardrails are still provided by collapsible rendering and natural JSON size.
const DEFAULT_MAX_RENDER_DEPTH = 100
const DEFAULT_EXPAND_DEPTH = 2

const tryParseJsonString = (value: string): unknown | null => {
    const trimmed = value.trim()
    if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return null
    try {
        const parsed = JSON.parse(trimmed)
        return typeof parsed === "object" && parsed !== null ? parsed : null
    } catch {
        return null
    }
}

const getTextPartContent = (rec: Record<string, unknown>): string | null => {
    if (rec.type !== "text") return null
    if (typeof rec.text === "string") return rec.text
    if (typeof rec.content === "string") return rec.content
    return null
}

const getNormalizedToolArgs = (raw: unknown): unknown => {
    if (typeof raw === "string") {
        return tryParseJsonString(raw) ?? raw
    }
    return raw
}

const getNormalizedToolResult = (raw: unknown): unknown => {
    if (typeof raw === "string") {
        return tryParseJsonString(raw) ?? raw
    }
    return raw
}

const formatToolCall = (name: string, rawArgs: unknown): string => {
    const args = getNormalizedToolArgs(rawArgs)
    if (!args || (typeof args === "object" && Object.keys(args as object).length === 0)) {
        return `${name}()`
    }
    try {
        return `${name}(${JSON.stringify(args, null, 2)})`
    } catch {
        return `${name}(...)`
    }
}

const getToolCallPartText = (rec: Record<string, unknown>): string | null => {
    if (rec.type !== "tool-call" && rec.type !== "tool_call") return null
    const name = rec.toolName ?? rec.name
    if (typeof name !== "string") return null
    return formatToolCall(name, rec.input ?? rec.args ?? rec.arguments)
}

const getToolResultPartText = (rec: Record<string, unknown>): string | null => {
    if (rec.type !== "tool-result" && rec.type !== "tool_result") return null
    const output = rec.output as Record<string, unknown> | undefined
    const value = getNormalizedToolResult(output?.value ?? output ?? rec.result ?? rec.content)
    return typeof value === "string" ? value : JSON.stringify(value, null, 2)
}

interface StructuredMessagePart {
    kind: "tool-call" | "tool-result"
    name: string
    value: unknown
}

const isToolCallPart = (rec: Record<string, unknown>): boolean =>
    rec.type === "tool-call" || rec.type === "tool_call"

const isToolResultPart = (rec: Record<string, unknown>): boolean =>
    rec.type === "tool-result" ||
    rec.type === "tool_result" ||
    rec.type === "tool-call-response" ||
    rec.type === "tool_call_response"

const getStructuredMessagePart = (part: unknown): StructuredMessagePart | null => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return null

    const rec = part as Record<string, unknown>
    if (isToolCallPart(rec)) {
        const name = rec.toolName ?? rec.name
        const rawArgs = rec.input ?? rec.args ?? rec.arguments
        return {
            kind: "tool-call",
            name: typeof name === "string" && name ? name : "tool call",
            value: getNormalizedToolArgs(rawArgs),
        }
    }

    if (isToolResultPart(rec)) {
        const output = rec.output as Record<string, unknown> | undefined
        const name = rec.toolName ?? rec.name
        const result = getNormalizedToolResult(output?.value ?? output ?? rec.result ?? rec.content)
        return {
            kind: "tool-result",
            name: `${typeof name === "string" && name ? name : "tool"} result`,
            value: result,
        }
    }

    return null
}

const getMessagePartText = (part: unknown): string | null => {
    if (!part || typeof part !== "object" || Array.isArray(part)) {
        return part === null || part === undefined ? "" : String(part)
    }

    const rec = part as Record<string, unknown>
    return (
        getTextPartContent(rec) ??
        getToolCallPartText(rec) ??
        getToolResultPartText(rec) ??
        (typeof rec.text === "string" ? rec.text : null) ??
        (typeof rec.content === "string" ? rec.content : null)
    )
}

const getStructuredMessageText = (content: unknown): string | null => {
    if (!content || typeof content !== "object") return null

    if (Array.isArray(content)) {
        const parts = content
            .map(getMessagePartText)
            .filter((part): part is string => part !== null)
        return parts.length > 0 ? parts.join("\n") : null
    }

    return getMessagePartText(content)
}

const getMessageContentParts = (content: unknown): unknown[] | null => {
    if (Array.isArray(content)) return content

    if (typeof content === "string") {
        const parsed = tryParseJsonString(content)
        if (Array.isArray(parsed)) return parsed
        if (
            parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as Record<string, unknown>).parts)
        ) {
            return (parsed as Record<string, unknown>).parts as unknown[]
        }
    }

    if (content && typeof content === "object" && !Array.isArray(content)) {
        const rec = content as Record<string, unknown>
        if (Array.isArray(rec.parts)) return rec.parts
    }

    return null
}

const getMessageContentDisplay = (
    content: unknown,
): {text: string; structuredParts: StructuredMessagePart[]} => {
    const parts = getMessageContentParts(content)
    if (!parts) {
        return {text: getMessageText(content), structuredParts: []}
    }

    const textParts: string[] = []
    const structuredParts: StructuredMessagePart[] = []

    for (const part of parts) {
        const structuredPart = getStructuredMessagePart(part)
        if (structuredPart) {
            structuredParts.push(structuredPart)
            continue
        }

        const textPart = getMessagePartText(part)
        if (textPart) textParts.push(textPart)
    }

    // Nothing recognizable inside the parsed parts (e.g. a tool message whose
    // content is a JSON array of `{response: ...}` envelopes we don't know).
    // Fall back to the raw payload so the bubble isn't empty.
    if (textParts.length === 0 && structuredParts.length === 0) {
        return {text: getMessageText(content), structuredParts: []}
    }

    return {text: textParts.join("\n"), structuredParts}
}

const simplifyValue = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value

    const rec = value as Record<string, unknown>

    // Text part: AI SDK uses {text}; PydanticAI/OpenAI parts may use {content}.
    const textPartContent = getTextPartContent(rec)
    if (textPartContent !== null) {
        return textPartContent
    }

    // Tool-call part: AI SDK uses tool-call/toolName/input; PydanticAI uses tool_call/name/arguments.
    if (isToolCallPart(rec)) {
        return {
            ...(rec.id ? {id: rec.id} : {}),
            name: rec.toolName ?? rec.name ?? "tool",
            arguments: getNormalizedToolArgs(rec.input ?? rec.args ?? rec.arguments),
        }
    }

    // Tool result/response envelope: unwrap to its structured result payload.
    if (isToolResultPart(rec)) {
        const output = rec.output as Record<string, unknown> | undefined
        const result = getNormalizedToolResult(output?.value ?? output ?? rec.result ?? rec.content)
        if (rec.id || rec.name || rec.toolName) {
            return {
                ...(rec.id ? {id: rec.id} : {}),
                name: rec.toolName ?? rec.name ?? "tool",
                result,
            }
        }
        return result
    }

    // Single-element array of a simplifiable item
    if (Array.isArray(value) && value.length === 1) {
        const simplified = simplifyValue(value[0])
        if (simplified !== value[0]) return simplified
    }

    // Multi-element array: simplify each element, join strings
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
        if (noiseKeys.length > 0) {
            const cleaned: Record<string, unknown> = {}
            for (const k of keys) {
                if (!METADATA_NOISE_KEYS.has(k)) {
                    cleaned[k] = rec[k]
                }
            }
            return cleaned
        }
    }

    return value
}

const isShortLeaf = (value: unknown): boolean => {
    if (value === null || value === undefined) return true
    if (typeof value === "boolean" || typeof value === "number") return true
    if (typeof value === "string" && value.length <= 120 && !value.includes("\n")) return true
    return false
}

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
    if (typeof content === "string") {
        const parsed = tryParseJsonString(content)
        const parsedText = parsed ? getStructuredMessageText(parsed) : null
        return parsedText ?? content
    }

    if (content && typeof content === "object" && !Array.isArray(content)) {
        const rec = content as Record<string, unknown>
        const partText = getMessagePartText(rec)
        if (partText !== null) return partText
    }

    if (Array.isArray(content)) {
        const partsText = getStructuredMessageText(content)
        if (partsText !== null) return partsText
    }

    try {
        return JSON.stringify(content, null, 2)
    } catch {
        return String(content)
    }
}

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

// ── Icons (static, no props — defined as elements to skip component overhead) ─

const CHEVRON_ICON = (
    <svg
        viewBox="0 0 24 24"
        className="w-2.5 h-2.5 stroke-current fill-none"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <polyline points="9 6 15 12 9 18" />
    </svg>
)

const COPY_ICON = (
    <svg
        viewBox="0 0 24 24"
        className="w-3 h-3 stroke-current fill-none"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
    >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
)

// ── Small components ────────────────────────────────────────────────────

const ScalarValue = ({value}: {value: unknown}) => {
    if (value === null || value === undefined) {
        return (
            <span className="font-mono text-[12.5px] text-[var(--ant-color-text-quaternary)] italic">
                null
            </span>
        )
    }
    if (typeof value === "boolean") {
        return (
            <span
                className={`font-mono text-[12.5px] ${value ? "text-green-7 dark:text-[var(--ant-green-7)]" : "text-orange-6"}`}
            >
                {String(value)}
            </span>
        )
    }
    if (typeof value === "number") {
        return (
            <span className="font-mono text-[12.5px] text-blue-7 dark:text-[var(--ant-blue-7)] tabular-nums">
                {String(value)}
            </span>
        )
    }
    if (typeof value === "string") {
        return <span className="font-mono text-[12.5px] text-[var(--ant-color-text)]">{value}</span>
    }
    return null
}

const CopyButton = ({value}: {value: unknown}) => {
    const [copied, setCopied] = useState(false)
    const timerRef = useRef<number | null>(null)

    useEffect(
        () => () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        },
        [],
    )

    const handleCopy = useCallback(
        async (e: React.MouseEvent) => {
            e.stopPropagation()
            const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) || ""
            if (!navigator.clipboard) return
            try {
                await navigator.clipboard.writeText(text)
                setCopied(true)
                if (timerRef.current !== null) window.clearTimeout(timerRef.current)
                timerRef.current = window.setTimeout(() => setCopied(false), 1200)
            } catch {}
        },
        [value],
    )

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
        e.stopPropagation()
    }, [])

    return (
        <button
            type="button"
            aria-label={copied ? "Copied" : "Copy to clipboard"}
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity inline-flex items-center justify-center h-[22px] min-w-[22px] px-1.5 ml-auto border border-transparent rounded-sm text-[var(--ant-color-text-quaternary)] cursor-pointer shrink-0 hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-container)] hover:border-[var(--ant-color-border)] focus-visible:ring-1 focus-visible:ring-[var(--ant-color-primary)] focus-visible:outline-none"
            onClick={handleCopy}
            onKeyDown={handleKeyDown}
        >
            {copied ? (
                <span className="text-[11px] text-green-6 font-medium">Copied</span>
            ) : (
                COPY_ICON
            )}
        </button>
    )
}

// ── NodeRow: unified row structure ──────────────────────────────────────
//
// Every row has the same layout:
//   [chevron 14px] [key (mono)] [meta or inline value] [copy-on-hover]
// so keys align in a single column at every depth. Containers get an
// interactive chevron; leaves get an invisible 14px spacer.

const NodeRow = memo(function NodeRow({
    keyLabel,
    meta,
    inlineValue,
    body,
    collapsible,
    defaultOpen = true,
    value,
    isSection,
    isMessage,
}: {
    keyLabel: React.ReactNode
    meta?: string
    inlineValue?: React.ReactNode
    body?: React.ReactNode
    collapsible?: boolean
    defaultOpen?: boolean
    value?: unknown
    isSection?: boolean
    isMessage?: boolean
}) {
    const [open, setOpen] = useState(defaultOpen)
    const toggle = useCallback(() => setOpen((o) => !o), [])
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((o) => !o)
        }
    }, [])

    return (
        <div className={isSection ? "pt-1 first:pt-0" : ""}>
            <div
                className={`group/row flex items-baseline gap-2 py-1 px-1 rounded-sm min-h-[24px] select-none ${collapsible ? "cursor-pointer sticky top-0 z-[1] bg-[var(--ant-color-bg-container)]" : ""} hover:bg-[var(--ant-color-fill-quaternary)] focus-visible:ring-1 focus-visible:ring-[var(--ant-color-primary)] focus-visible:outline-none`}
                onClick={collapsible ? toggle : undefined}
                role={collapsible ? "button" : undefined}
                tabIndex={collapsible ? 0 : undefined}
                aria-expanded={collapsible ? open : undefined}
                onKeyDown={collapsible ? handleKeyDown : undefined}
            >
                <span
                    className={`inline-flex items-center justify-center w-3.5 h-3.5 shrink-0 relative top-px text-[var(--ant-color-text-quaternary)] ${!collapsible ? "invisible" : ""}`}
                >
                    {collapsible && (
                        <span
                            className={`inline-flex motion-safe:transition-transform motion-safe:duration-150 ${open ? "rotate-90" : ""}`}
                        >
                            {CHEVRON_ICON}
                        </span>
                    )}
                </span>

                {isMessage ? (
                    <span className="whitespace-nowrap shrink-0 text-xs">{keyLabel}</span>
                ) : (
                    <span
                        className={`font-mono whitespace-nowrap shrink-0 text-[var(--ant-color-text)] ${isSection ? "font-medium text-[13px]" : "text-[12.5px]"}`}
                    >
                        {keyLabel}
                    </span>
                )}

                {meta ? (
                    <span className="text-[11px] text-[var(--ant-color-text-quaternary)] font-mono shrink-0 whitespace-nowrap">
                        {meta}
                    </span>
                ) : null}

                {inlineValue ? (
                    <span className="font-mono text-[12.5px] break-all ml-1 min-w-0">
                        {inlineValue}
                    </span>
                ) : null}

                {value !== undefined ? <CopyButton value={value} /> : null}
            </div>

            {body && open ? (
                // border-0 then border-l then border-solid: Ant Design's CSS layer
                // overrides Tailwind preflight, so border-style must be set explicitly.
                <div className="ml-[7px] pl-3.5 border-0 border-l border-solid border-[var(--ant-color-border-secondary)] flex flex-col mt-0.5 mb-1">
                    {body}
                </div>
            ) : null}
        </div>
    )
})

// ── TruncatedMessageBody ───────────────────────────────────────────────
//
// Wraps the editor for a chat message. When the content exceeds
// TRUNCATE_HEIGHT_PX the body is clamped with a bottom fade overlay and
// a centered "Show more" pill. Clicking the pill expands to full height
// and shows a "Show less" pill at the bottom.

const TRUNCATE_HEIGHT_PX = 160

const PILL_BUTTON_CLASSES =
    "text-[11px] font-medium text-[var(--ant-color-text-secondary)] bg-[var(--ant-color-fill-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)] border border-solid border-[var(--ant-color-border-secondary)] rounded-full px-3 py-0.5 cursor-pointer focus-visible:ring-1 focus-visible:ring-[var(--ant-color-primary)] focus-visible:outline-none motion-safe:transition-colors"

const TruncatedMessageBody = memo(function TruncatedMessageBody({
    editorId,
    text,
}: {
    editorId: string
    text: string
}) {
    const measureRef = useRef<HTMLDivElement>(null)
    const [needsTruncation, setNeedsTruncation] = useState(false)
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        setExpanded(false)
        const el = measureRef.current
        if (!el) return
        const check = () => setNeedsTruncation(el.scrollHeight > TRUNCATE_HEIGHT_PX + 8)
        check()
        const observer = new ResizeObserver(check)
        observer.observe(el)
        return () => observer.disconnect()
    }, [text])

    const toggle = useCallback(() => setExpanded((v) => !v), [])

    const isTruncated = needsTruncation && !expanded

    return (
        <div className="relative">
            <div
                className={`${isTruncated ? "overflow-hidden" : ""} motion-safe:transition-[max-height] motion-safe:duration-200`}
                style={{maxHeight: isTruncated ? TRUNCATE_HEIGHT_PX : undefined}}
            >
                <div ref={measureRef}>
                    <EditorProvider
                        key={text}
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
            </div>

            {isTruncated ? (
                <div className="absolute bottom-0 left-0 right-0 flex flex-col items-center">
                    <div
                        className="w-full h-10 bg-gradient-to-t from-[var(--ant-color-bg-container)] to-transparent pointer-events-none"
                        aria-hidden="true"
                    />
                    <div className="w-full flex justify-center pb-1 bg-[var(--ant-color-bg-container)]">
                        <button
                            type="button"
                            onClick={toggle}
                            aria-expanded={false}
                            className={PILL_BUTTON_CLASSES}
                        >
                            Show more
                        </button>
                    </div>
                </div>
            ) : null}

            {needsTruncation && expanded ? (
                <div className="flex justify-center pt-1 pb-0.5">
                    <button
                        type="button"
                        onClick={toggle}
                        aria-expanded={true}
                        className={PILL_BUTTON_CLASSES}
                    >
                        Show less
                    </button>
                </div>
            ) : null}
        </div>
    )
})

// ── Tool call helpers ───────────────────────────────────────────────────

const getToolCallName = (tc: unknown): string => {
    const obj = tc as Record<string, unknown> | null
    const fn = obj?.function as Record<string, unknown> | undefined
    return String(fn?.name || obj?.name || "tool")
}

const getToolCallArgs = (tc: unknown): unknown => {
    const obj = tc as Record<string, unknown> | null
    const fn = obj?.function as Record<string, unknown> | undefined
    const raw = fn?.arguments ?? obj?.arguments ?? obj?.input ?? obj?.args
    return getNormalizedToolArgs(raw)
}

const getMessageMeta = (
    text: string,
    toolCalls?: unknown[],
    structuredParts?: StructuredMessagePart[],
): string => {
    const parts: string[] = []
    if (text) parts.push(`${text.length} chars`)
    const toolCallCount =
        (toolCalls?.length ?? 0) +
        (structuredParts?.filter((part) => part.kind === "tool-call").length ?? 0)
    const toolResultCount =
        structuredParts?.filter((part) => part.kind === "tool-result").length ?? 0
    if (toolCallCount) {
        parts.push(`${toolCallCount} tool ${toolCallCount === 1 ? "call" : "calls"}`)
    }
    if (toolResultCount) {
        parts.push(`${toolResultCount} tool ${toolResultCount === 1 ? "result" : "results"}`)
    }
    return parts.join(", ") || "empty"
}

// ── MessageNodeRow ──────────────────────────────────────────────────────

const MessageNodeRow = memo(function MessageNodeRow({
    msg,
    index,
    keyPrefix,
}: {
    msg: {role: string; content: unknown; tool_calls?: unknown[]}
    index: number
    keyPrefix: string
}) {
    const role = (msg.role || "").toLowerCase()
    const roleColor = ROLE_COLOR_CLASSES[role] ?? DEFAULT_ROLE_COLOR_CLASS
    const {text, structuredParts} = useMemo(
        () => getMessageContentDisplay(msg.content),
        [msg.content],
    )
    const editorId = `${keyPrefix}-msg-${index}`
    const toolCalls = msg.tool_calls

    const label = useMemo(
        () => <span className={`font-medium capitalize ${roleColor}`}>{msg.role || "—"}</span>,
        [msg.role, roleColor],
    )

    const parsedContent = useMemo(() => {
        if (role !== "tool" || !text) return null
        try {
            const parsed = JSON.parse(text)
            return typeof parsed === "object" && parsed !== null ? parsed : null
        } catch {
            return null
        }
    }, [role, text])

    const body = useMemo(() => {
        const hasToolCalls = toolCalls && toolCalls.length > 0
        const hasStructuredParts = structuredParts.length > 0

        if (parsedContent && !hasStructuredParts) {
            return (
                <div className="flex flex-col gap-1">
                    <RecursiveNode
                        name="result"
                        value={parsedContent}
                        keyPrefix={`${editorId}-result`}
                        depth={1}
                        expandDepth={2}
                    />
                </div>
            )
        }

        const hasText = text.length > 0
        if (!hasText && !hasToolCalls && !hasStructuredParts) return null

        return (
            <div className="flex flex-col gap-1">
                {hasText && <TruncatedMessageBody editorId={editorId} text={text} />}
                {structuredParts.map((part, i) => (
                    <RecursiveNode
                        key={`${part.kind}-${i}`}
                        name={part.name}
                        value={part.value}
                        keyPrefix={`${editorId}-part-${i}`}
                        depth={1}
                        expandDepth={2}
                    />
                ))}
                {hasToolCalls &&
                    toolCalls.map((tc, i) => (
                        <RecursiveNode
                            key={i}
                            name={getToolCallName(tc)}
                            value={getToolCallArgs(tc)}
                            keyPrefix={`${editorId}-tc-${i}`}
                            depth={1}
                            expandDepth={2}
                        />
                    ))}
            </div>
        )
    }, [text, toolCalls, editorId, parsedContent, structuredParts])

    return (
        <NodeRow
            keyLabel={label}
            meta={getMessageMeta(text, toolCalls, structuredParts)}
            isMessage
            collapsible
            defaultOpen
            value={msg.content ?? (toolCalls ? JSON.stringify(toolCalls) : "")}
            body={body}
        />
    )
})

// ── RecursiveNode ───────────────────────────────────────────────────────

const RecursiveNode = memo(function RecursiveNode({
    name,
    value: rawValue,
    keyPrefix,
    depth = 0,
    maxDepth = DEFAULT_MAX_RENDER_DEPTH,
    expandDepth = DEFAULT_EXPAND_DEPTH,
    parentIsArray = false,
    isSection = false,
}: {
    name: string | number
    value: unknown
    keyPrefix: string
    depth?: number
    maxDepth?: number
    expandDepth?: number
    parentIsArray?: boolean
    isSection?: boolean
}) {
    const value = useMemo(() => simplifyValue(rawValue), [rawValue])
    const keyLabel = parentIsArray ? `[${name}]` : String(name)
    const nodePrefix = `${keyPrefix}-${name}`

    const chatResult = useMemo(() => shallowExtractChatMessages(value), [value])

    const siblingEntries = useMemo(() => {
        if (!chatResult?.viaKey || !value || typeof value !== "object" || Array.isArray(value))
            return null
        const entries = Object.entries(value as Record<string, unknown>).filter(
            ([k]) =>
                k !== chatResult.viaKey && (chatResult.viaKey !== "choices" || k !== "choices"),
        )
        return entries.length > 0 ? entries : null
    }, [chatResult, value])

    if (chatResult && !chatResult.viaKey) {
        const normalized = normalizeChatMessages(chatResult.messages)
        return (
            <NodeRow
                keyLabel={keyLabel}
                meta={`${normalized.length} ${normalized.length === 1 ? "message" : "messages"}`}
                collapsible
                defaultOpen={depth < expandDepth}
                value={value}
                isSection={isSection}
                body={
                    <div className="flex flex-col gap-0.5 py-0.5">
                        {normalized.map((msg, i) => (
                            <MessageNodeRow key={i} msg={msg} index={i} keyPrefix={nodePrefix} />
                        ))}
                    </div>
                }
            />
        )
    }

    if (chatResult && chatResult.viaKey) {
        const normalized = normalizeChatMessages(chatResult.messages)
        const chatKey = chatResult.viaKey
        const entries: [string, unknown][] = value
            ? Object.entries(value as Record<string, unknown>)
            : []
        const count = entries.length
        const meta = `{${count} ${count === 1 ? "key" : "keys"}}`
        return (
            <NodeRow
                keyLabel={keyLabel}
                meta={meta}
                collapsible
                defaultOpen={depth < expandDepth}
                value={value}
                isSection={isSection}
                body={
                    <>
                        <NodeRow
                            keyLabel={chatKey}
                            meta={`${normalized.length} ${normalized.length === 1 ? "message" : "messages"}`}
                            collapsible
                            defaultOpen={depth + 1 < expandDepth}
                            value={chatResult.messages}
                            body={
                                <div className="flex flex-col gap-0.5 py-0.5">
                                    {normalized.map((msg, i) => (
                                        <MessageNodeRow
                                            key={i}
                                            msg={msg}
                                            index={i}
                                            keyPrefix={`${nodePrefix}-${chatKey}`}
                                        />
                                    ))}
                                </div>
                            }
                        />
                        {siblingEntries?.map(([k, v]) => (
                            <RecursiveNode
                                key={k}
                                name={k}
                                value={v}
                                keyPrefix={nodePrefix}
                                depth={depth + 1}
                                maxDepth={maxDepth}
                                expandDepth={expandDepth}
                            />
                        ))}
                    </>
                }
            />
        )
    }

    if (isShortLeaf(value)) {
        return (
            <NodeRow
                keyLabel={keyLabel}
                inlineValue={<ScalarValue value={value} />}
                collapsible={false}
                value={value}
                isSection={isSection}
            />
        )
    }

    if (typeof value === "string") {
        return (
            <NodeRow
                keyLabel={keyLabel}
                meta={`${value.length} chars`}
                collapsible
                defaultOpen={depth < expandDepth}
                value={value}
                isSection={isSection}
                body={
                    <EditorProvider
                        id={nodePrefix}
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
                }
            />
        )
    }

    if (value && typeof value === "object") {
        const isArray = Array.isArray(value)
        const entries: [string, unknown][] = isArray
            ? value.map((v, i) => [String(i), v])
            : Object.entries(value as Record<string, unknown>)
        const count = entries.length
        const meta = isArray
            ? `[${count} ${count === 1 ? "item" : "items"}]`
            : `{${count} ${count === 1 ? "key" : "keys"}}`

        if (depth >= maxDepth) {
            return (
                <NodeRow
                    keyLabel={keyLabel}
                    meta={meta}
                    collapsible={false}
                    value={value}
                    isSection={isSection}
                />
            )
        }

        return (
            <NodeRow
                keyLabel={keyLabel}
                meta={meta}
                collapsible={count > 0}
                defaultOpen={depth < expandDepth}
                value={value}
                isSection={isSection}
                body={
                    count > 0
                        ? entries.map(([k, v]) => (
                              <RecursiveNode
                                  key={k}
                                  name={k}
                                  value={v}
                                  keyPrefix={nodePrefix}
                                  depth={depth + 1}
                                  maxDepth={maxDepth}
                                  expandDepth={expandDepth}
                                  parentIsArray={isArray}
                              />
                          ))
                        : undefined
                }
            />
        )
    }

    return (
        <NodeRow
            keyLabel={keyLabel}
            inlineValue={
                <span className="font-mono text-[12.5px] text-[var(--ant-color-text)]">
                    {valueToString(value)}
                </span>
            }
            collapsible={false}
            value={value}
            isSection={isSection}
        />
    )
})

// ── Top-level entry point ───────────────────────────────────────────────

export const PrettyJsonView = memo(function PrettyJsonView({
    data: rawData,
    keyPrefix,
}: {
    data: unknown
    keyPrefix: string
}) {
    const data = useMemo(() => simplifyValue(rawData), [rawData])
    const topChatResult = useMemo(() => shallowExtractChatMessages(data), [data])

    const agDataExpandKeys = useMemo(() => {
        if (!data || typeof data !== "object" || Array.isArray(data)) return null
        const rec = data as Record<string, unknown>
        const keys = new Set<string>()
        const hasNestedData = (obj: unknown): boolean => {
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false
            const o = obj as Record<string, unknown>
            return o.data !== undefined && typeof o.data === "object" && !Array.isArray(o.data)
        }
        if (rec.ag && hasNestedData(rec.ag)) {
            keys.add("ag")
        }
        if (
            rec.attributes &&
            typeof rec.attributes === "object" &&
            !Array.isArray(rec.attributes)
        ) {
            const attrs = rec.attributes as Record<string, unknown>
            if (attrs.ag && hasNestedData(attrs.ag)) {
                keys.add("attributes")
            }
        }
        return keys.size > 0 ? keys : null
    }, [data])

    const topSiblingEntries = useMemo(() => {
        if (!topChatResult?.viaKey || !data || typeof data !== "object" || Array.isArray(data))
            return null
        const entries = Object.entries(data as Record<string, unknown>).filter(
            ([k]) =>
                k !== topChatResult.viaKey &&
                (topChatResult.viaKey !== "choices" || k !== "choices"),
        )
        return entries.length > 0 ? entries : null
    }, [topChatResult, data])

    if (topChatResult && !topChatResult.viaKey) {
        const normalized = normalizeChatMessages(topChatResult.messages)
        return (
            <div className="text-[13px] p-2 px-3 pb-4">
                <div className="flex flex-col gap-0.5">
                    {normalized.map((msg, i) => (
                        <MessageNodeRow key={i} msg={msg} index={i} keyPrefix={keyPrefix} />
                    ))}
                </div>
            </div>
        )
    }

    if (topChatResult && topChatResult.viaKey) {
        const normalized = normalizeChatMessages(topChatResult.messages)
        const chatKey = topChatResult.viaKey
        return (
            <div className="text-[13px] p-2 px-3 pb-4">
                <NodeRow
                    keyLabel={chatKey}
                    meta={`${normalized.length} ${normalized.length === 1 ? "message" : "messages"}`}
                    collapsible
                    defaultOpen
                    value={topChatResult.messages}
                    isSection
                    body={
                        <div className="flex flex-col gap-0.5 py-0.5">
                            {normalized.map((msg, i) => (
                                <MessageNodeRow
                                    key={i}
                                    msg={msg}
                                    index={i}
                                    keyPrefix={`${keyPrefix}-${chatKey}`}
                                />
                            ))}
                        </div>
                    }
                />
                {topSiblingEntries?.map(([key, value]) => (
                    <RecursiveNode
                        key={key}
                        name={key}
                        value={value}
                        keyPrefix={keyPrefix}
                        depth={0}
                        expandDepth={
                            agDataExpandKeys?.has(key)
                                ? DEFAULT_MAX_RENDER_DEPTH
                                : DEFAULT_EXPAND_DEPTH
                        }
                        isSection
                    />
                ))}
            </div>
        )
    }

    if (typeof data === "string") {
        return (
            <div className="text-[13px] p-2 px-3 pb-4">
                <RecursiveNode name="root" value={data} keyPrefix={keyPrefix} depth={0} isSection />
            </div>
        )
    }

    if (data && typeof data === "object" && !Array.isArray(data)) {
        const entries = Object.entries(data as Record<string, unknown>)
        return (
            <div className="text-[13px] p-2 px-3 pb-4">
                {entries.map(([key, value]) => (
                    <RecursiveNode
                        key={key}
                        name={key}
                        value={value}
                        keyPrefix={keyPrefix}
                        depth={0}
                        expandDepth={
                            agDataExpandKeys?.has(key)
                                ? DEFAULT_MAX_RENDER_DEPTH
                                : DEFAULT_EXPAND_DEPTH
                        }
                        isSection
                    />
                ))}
            </div>
        )
    }

    return (
        <div className="text-[13px] p-2 px-3 pb-4">
            <RecursiveNode name="root" value={data} keyPrefix={keyPrefix} depth={0} isSection />
        </div>
    )
})
