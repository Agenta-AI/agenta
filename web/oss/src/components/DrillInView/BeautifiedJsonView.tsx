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
 * "Beautified JSON" view.
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
 * "Beautified JSON" is not JSON -- it hides fields, restructures values, and
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

const DEFAULT_MAX_RENDER_DEPTH = 5
const DEFAULT_EXPAND_DEPTH = 2

const simplifyValue = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value

    const rec = value as Record<string, unknown>

    if (rec.type === "text" && typeof rec.text === "string") {
        return rec.text
    }

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

    if (rec.type === "tool-result" && rec.output !== undefined) {
        const output = rec.output as Record<string, unknown> | undefined
        if (output && typeof output === "object" && output.value !== undefined) {
            return output.value
        }
        return rec.output
    }

    if (Array.isArray(value) && value.length === 1) {
        const simplified = simplifyValue(value[0])
        if (simplified !== value[0]) return simplified
    }

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
            <span className={`font-mono text-[12.5px] ${value ? "text-green-7" : "text-orange-6"}`}>
                {String(value)}
            </span>
        )
    }
    if (typeof value === "number") {
        return (
            <span className="font-mono text-[12.5px] text-blue-7 tabular-nums">
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
    const timerRef = useRef<ReturnType<typeof setTimeout>>()

    useEffect(() => () => clearTimeout(timerRef.current), [])

    const handleCopy = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) || ""
            navigator.clipboard
                ?.writeText(text)
                ?.then(() => {
                    setCopied(true)
                    clearTimeout(timerRef.current)
                    timerRef.current = setTimeout(() => setCopied(false), 1200)
                })
                ?.catch(() => {})
        },
        [value],
    )

    return (
        <button
            type="button"
            aria-label={copied ? "Copied" : "Copy to clipboard"}
            className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity inline-flex items-center justify-center h-[22px] min-w-[22px] px-1.5 ml-auto border border-transparent rounded-sm text-[var(--ant-color-text-quaternary)] cursor-pointer shrink-0 hover:text-[var(--ant-color-text)] hover:bg-[var(--ant-color-bg-container)] hover:border-[var(--ant-color-border)] focus-visible:ring-1 focus-visible:ring-[var(--ant-color-primary)] focus-visible:outline-none"
            onClick={handleCopy}
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
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setOpen((o) => !o)
        }
    }, [])

    return (
        <div className={isSection ? "pt-1 first:pt-0" : ""}>
            <div
                className={`group/row flex items-baseline gap-2 py-1 px-1 rounded-sm min-h-[24px] select-none ${collapsible ? "cursor-pointer" : ""} hover:bg-[var(--ant-color-fill-quaternary)] focus-visible:ring-1 focus-visible:ring-[var(--ant-color-primary)] focus-visible:outline-none`}
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

// ── MessageNodeRow ──────────────────────────────────────────────────────

const MessageNodeRow = memo(function MessageNodeRow({
    msg,
    index,
    keyPrefix,
}: {
    msg: {role: string; content: unknown}
    index: number
    keyPrefix: string
}) {
    const role = (msg.role || "").toLowerCase()
    const roleColor = ROLE_COLOR_CLASSES[role] ?? DEFAULT_ROLE_COLOR_CLASS
    const text = getMessageText(msg.content)
    const editorId = `${keyPrefix}-msg-${index}`

    const label = useMemo(
        () => <span className={`font-medium capitalize ${roleColor}`}>{msg.role || "—"}</span>,
        [msg.role, roleColor],
    )

    const body = useMemo(
        () => (
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
        ),
        [editorId, text],
    )

    return (
        <NodeRow
            keyLabel={label}
            meta={`${text.length} chars`}
            isMessage
            collapsible
            defaultOpen
            value={text}
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
    if (chatResult) {
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

export const BeautifiedJsonView = memo(function BeautifiedJsonView({
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

    if (topChatResult) {
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
