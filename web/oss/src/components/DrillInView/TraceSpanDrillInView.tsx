import {
    memo,
    type ReactNode,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useState,
} from "react"

import {traceSpanMolecule} from "@agenta/entities/trace"
import {
    CopyButton,
    Editor as EditorWrapper,
    EditorProvider,
    DrillInProvider,
    useLexicalComposerContext,
    ON_CHANGE_LANGUAGE,
    SET_MARKDOWN_VIEW,
    SearchPlugin,
} from "@agenta/ui"
import {
    extractChatMessages,
    normalizeChatMessages,
    ROLE_COLOR_CLASSES,
    DEFAULT_ROLE_COLOR_CLASS,
} from "@agenta/ui/cell-renderers"
import {
    ArrowDownIcon,
    ArrowUpIcon,
    CaretDown,
    CaretRight,
    CopyIcon,
    DownloadIcon,
    FileTextIcon,
    MagnifyingGlassIcon,
    XIcon,
} from "@phosphor-icons/react"
import {Button, Input, Select} from "antd"
import {useAtomValue} from "jotai"
import yaml from "js-yaml"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {getStringOrJson, sanitizeDataWithBlobUrls} from "@/oss/lib/helpers/utils"

import type {DrillInContentProps} from "./DrillInContent"
import {EntityDrillInView} from "./EntityDrillInView"
const ImagePreview = dynamic(() => import("@agenta/ui").then((mod) => mod.ImagePreview), {
    ssr: false,
})

// ============================================================================
// TYPES
// ============================================================================

export interface TraceSpanDrillInViewProps extends Omit<
    DrillInContentProps,
    "getValue" | "setValue" | "getRootItems" | "valueMode"
> {
    /** The span ID to display */
    spanId: string
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Whether editing is enabled (default: false for traces) */
    editable?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication) */
    mappedPaths?: Map<string, string>
    /** Path to focus/navigate to (e.g., "data.inputs.prompt") */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked */
    onPropertyClick?: (path: string) => void
    /** Initial path to start navigation at */
    initialPath?: string | string[]
    /** Hide breadcrumb row (useful when parent already handles navigation layout) */
    hideBreadcrumb?: boolean
    /** Enables drill-in action button in field headers (default: true) */
    showFieldDrillIn?: boolean
    /** Enables explicit view mode selector for field content (JSON/YAML/Text/Markdown) */
    enableFieldViewModes?: boolean
    /** Root scope to render: span attributes (default) or full span payload */
    rootScope?: "attributes" | "span"
    /** View-mode preset for span content rendering */
    viewModePreset?: "default" | "message"
    /** Controls collapse behavior for rootScope="span" */
    allowSpanCollapse?: boolean
    /** Optional override data for rootScope="span" rendering */
    spanDataOverride?: unknown
}

type RawSpanViewMode = "json" | "yaml"

type RawSpanDisplayMode = RawSpanViewMode | "rendered-json" | "text" | "markdown"

const RAW_SPAN_VIEW_MODE_LABELS: Record<RawSpanDisplayMode, string> = {
    json: "JSON",
    yaml: "YAML",
    "rendered-json": "Rendered JSON",
    text: "Text",
    markdown: "Markdown",
}

const getDefaultRawSpanViewMode = (availableModes: RawSpanDisplayMode[]): RawSpanDisplayMode => {
    if (availableModes.includes("rendered-json")) return "rendered-json"
    return availableModes[0] ?? "json"
}

const normalizeEscapedLineBreaks = (value: string): string =>
    value.replaceAll("\\r\\n", "\n").replaceAll("\\n", "\n")

const parseStructuredJson = (value: string): unknown | null => {
    const tryParseJson = (input: string): unknown | null => {
        try {
            return JSON.parse(input)
        } catch {
            return null
        }
    }

    const toStructured = (parsed: unknown): unknown | null => {
        if (parsed && typeof parsed === "object") return parsed
        if (typeof parsed !== "string") return null

        const nested = tryParseJson(parsed.trim())
        if (nested && typeof nested === "object") return nested
        return null
    }

    let candidate = value.trim()
    if (!candidate) return null

    const fencedMatch = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    if (fencedMatch?.[1]) {
        candidate = fencedMatch[1].trim()
    }

    const strictParsed = toStructured(tryParseJson(candidate))
    if (strictParsed !== null) return strictParsed

    try {
        return toStructured(JSON5.parse(candidate))
    } catch {
        return null
    }
}

// ============================================================================
// VALUE SIMPLIFICATION
// ============================================================================

/** Keys that are metadata noise — filtered out in rendered JSON mode */
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
    "experimental_providerMetadata",
])

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

    // Single-element array of a simplifiable item: [{type: "text", text: "hello"}] → "hello"
    if (Array.isArray(value) && value.length === 1) {
        const simplified = simplifyValue(value[0])
        if (simplified !== value[0]) return simplified
    }

    // Multi-element array: simplify each element
    if (Array.isArray(value) && value.length > 1) {
        const simplified = value.map(simplifyValue)
        const changed = simplified.some((s, i) => s !== value[i])
        if (changed) {
            // If all simplified to strings, join them
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
            // If only one meaningful key remains, unwrap it
            const cleanedKeys = Object.keys(cleaned)
            if (cleanedKeys.length === 1) {
                return cleaned[cleanedKeys[0]]
            }
            return cleaned
        }
    }

    return value
}

/** Format a key label: snake_case → Title Case */
const formatLabel = (key: string): string =>
    key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\b\w/g, (c) => c.toUpperCase())

const EDITOR_RESET_CLASSES =
    "!min-h-0 [&_.editor-inner]:!border-0 [&_.editor-inner]:!rounded-none [&_.editor-inner]:!min-h-0 [&_.editor-container]:!bg-transparent [&_.editor-container]:!min-h-0 [&_.editor-input]:!min-h-0 [&_.editor-input]:!px-0 [&_.editor-input]:!py-0 [&_.editor-paragraph]:!mb-1 [&_.editor-paragraph:last-child]:!mb-0 [&_.agenta-editor-wrapper]:!min-h-0"

/** Get text content from a chat message, with AI SDK part awareness */
const getMessageText = (content: unknown): string => {
    if (content === null || content === undefined) return ""
    if (typeof content === "string") return content

    // Single AI SDK part object
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
        // Collect text from all parts
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

/**
 * Renders chat messages with editor-backed content for markdown support.
 * Each message gets a role label + EditorProvider for its content.
 */
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

/** Convert a value to a string for display in the editor */
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

/**
 * Read-only variable field: renders a labeled value using EditorProvider,
 * matching the playground's variable display with markdown support.
 */
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

/**
 * Renders a value with smart type detection:
 * - Chat messages → RenderedChatMessages (editor-backed)
 * - Plain objects → labeled variable fields (recursive)
 * - Primitives → read-only editor field
 * - Arrays → per-item rendering
 */
const DEFAULT_MAX_RENDER_DEPTH = 5

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
    // Simplify envelopes and strip metadata before rendering
    const value = useMemo(() => simplifyValue(rawValue), [rawValue])

    const chatMessages = useMemo(() => extractChatMessages(value), [value])

    if (chatMessages && chatMessages.length > 0) {
        return <RenderedChatMessages messages={chatMessages} keyPrefix={keyPrefix} />
    }

    if (value === null || value === undefined) {
        return <span className="text-[#758391]">—</span>
    }

    // After simplification, primitives render as text
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

    // Non-empty array of objects → render each item recursively
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

    // Plain object → render each key as a variable field, simplifying nested values
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>)
        return (
            <div className="flex flex-col gap-2">
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
                    // Recurse for nested objects instead of stringifying (up to depth limit)
                    if (
                        depth < maxDepth &&
                        simplified &&
                        typeof simplified === "object" &&
                        !Array.isArray(simplified)
                    ) {
                        return (
                            <div key={k} className="flex flex-col gap-1">
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

    // Primitives, arrays, anything else → single editor
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
 * Rendered JSON view for a span field.
 * - If the entire value is chat-like (single message or array), render as chat.
 * - If it's an object, render each top-level key separately,
 *   detecting chat vs non-chat per key.
 * - Otherwise render as formatted text.
 */
const RenderedJsonView = memo(function RenderedJsonView({
    data: rawData,
    keyPrefix,
}: {
    data: unknown
    keyPrefix: string
}) {
    // Simplify envelopes (tool-call, tool-result, text parts) before rendering
    const data = useMemo(() => simplifyValue(rawData), [rawData])

    // Determine if this is a direct chat value:
    // - Array of messages → render as chat
    // - Single message object (has "role" key) → render as chat
    // - Object with multiple keys (some may contain chat) → render per-key
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

    // For non-chat objects, render each key separately
    const entries = useMemo(() => {
        if (typeof data === "string") return null
        if (isDirectChat) return null
        if (!data || typeof data !== "object" || Array.isArray(data)) return null
        return Object.entries(data as Record<string, unknown>)
    }, [data, isDirectChat])

    // If simplification produced a string, render as text directly
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

    // Primitive or array fallback
    return (
        <div className="p-4">
            <RenderedValueBlock value={data} keyPrefix={keyPrefix} />
        </div>
    )
})

const LanguageAwareViewer = ({
    initialValue,
    language,
    searchProps,
}: {
    initialValue: string
    language: RawSpanDisplayMode
    searchProps?: {
        searchTerm: string
        currentResultIndex: number
        onResultCountChange: (count: number) => void
    }
}) => {
    const [editor] = useLexicalComposerContext()
    const changeLanguage = useCallback(
        (lang: RawSpanViewMode) => {
            editor.dispatchCommand(ON_CHANGE_LANGUAGE, {language: lang})
        },
        [editor],
    )

    useEffect(() => {
        changeLanguage(language === "yaml" ? "yaml" : "json")
        editor.setEditable(false)
    }, [changeLanguage, editor, language])

    const additionalPlugins = useMemo(() => {
        if (!searchProps) return []
        return [
            <SearchPlugin
                key="search"
                searchTerm={searchProps.searchTerm}
                currentResultIndex={searchProps.currentResultIndex}
                onResultCountChange={searchProps.onResultCountChange}
            />,
        ]
    }, [searchProps])

    const editorNode = (
        <EditorWrapper
            initialValue={initialValue}
            language={language === "yaml" ? "yaml" : "json"}
            codeOnly={true}
            showToolbar={false}
            enableTokens={false}
            disabled
            noProvider
            readOnly
            additionalCodePlugins={additionalPlugins}
        />
    )

    return editorNode
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

const TextModeViewer = ({
    editorId,
    value,
    mode,
}: {
    editorId: string
    value: string
    mode: "text" | "markdown"
}) => {
    return (
        <EditorProvider
            id={editorId}
            initialValue={value}
            showToolbar={false}
            enableTokens={false}
            readOnly
            className="[&_.editor-inner]:!border-0 [&_.editor-inner]:!rounded-none [&_.editor-container]:!bg-transparent [&_.editor-input]:!min-h-0 [&_.editor-input]:!px-4 [&_.editor-input]:!py-[6px] [&_.editor-paragraph]:!mb-1 [&_.editor-paragraph:last-child]:!mb-0 [&_.editor-input.markdown-view_.editor-code]:!m-0 [&_.editor-input.markdown-view_.editor-code]:!p-0 [&_.editor-input.markdown-view_.editor-code]:!bg-transparent"
        >
            <MarkdownModeSync isMarkdownView={mode === "text"} />
            <EditorWrapper
                initialValue={value}
                disabled
                codeOnly={false}
                showToolbar={false}
                boundHeight={false}
                noProvider
                readOnly
            />
        </EditorProvider>
    )
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Drill-in viewer for trace span data.
 *
 * Uses the unified traceSpan entity API for all state management.
 * This is a thin wrapper that passes the trace controller to EntityDrillInView.
 *
 * Default behavior for traces:
 * - Read-only (editable=false)
 * - No add/delete controls
 * - Root title is "data"
 *
 * @example
 * ```tsx
 * // Read-only trace viewing with column mapping
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   columnOptions={columnOptions}
 *   onMapToColumn={handleMap}
 *   mappedPaths={mappedPaths}
 * />
 *
 * // Editable trace
 * <TraceSpanDrillInView
 *   spanId={spanId}
 *   editable={true}
 * />
 * ```
 */
export const TraceSpanDrillInView = memo(
    ({
        spanId,
        title = "data",
        breadcrumbPrefix,
        showBackArrow = true,
        editable = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        mappedPaths,
        focusPath,
        onFocusPathHandled,
        onPropertyClick,
        initialPath,
        hideBreadcrumb,
        showFieldDrillIn,
        enableFieldViewModes,
        hideSingleFieldHeader,
        hideFieldHeaders,
        showFieldCollapse,
        rootScope = "attributes",
        viewModePreset = "default",
        allowSpanCollapse = true,
        spanDataOverride,
    }: TraceSpanDrillInViewProps) => {
        const spanEntityData = useAtomValue(traceSpanMolecule.selectors.data(spanId))
        const spanData = spanDataOverride !== undefined ? spanDataOverride : spanEntityData
        const textViewerId = useId().replace(/:/g, "")

        const {
            data: sanitizedSpanData,
            fileAttachments,
            imageAttachments,
        } = useMemo(() => sanitizeDataWithBlobUrls(spanData), [spanData])

        const [isCollapsed, setIsCollapsed] = useState(false)
        const [isSearchOpen, setIsSearchOpen] = useState(false)
        const [searchTerm, setSearchTerm] = useState("")
        const [currentResultIndex, setCurrentResultIndex] = useState(0)
        const [resultCount, setResultCount] = useState(0)

        const isStringValue = typeof sanitizedSpanData === "string"
        const isObjectOrArrayValue =
            sanitizedSpanData !== null && typeof sanitizedSpanData === "object"
        const parsedStructuredString = useMemo(
            () => (isStringValue ? parseStructuredJson(sanitizedSpanData) : null),
            [isStringValue, sanitizedSpanData],
        )

        const jsonOutput = useMemo(
            () =>
                isStringValue
                    ? parsedStructuredString !== null
                        ? sanitizedSpanData
                        : (JSON.stringify(sanitizedSpanData) ?? "")
                    : getStringOrJson(sanitizedSpanData),
            [isStringValue, parsedStructuredString, sanitizedSpanData],
        )
        const yamlOutput = useMemo(() => {
            const yamlSource = isStringValue ? parsedStructuredString : sanitizedSpanData
            if (yamlSource === null || yamlSource === undefined) return ""
            try {
                return yaml.dump(yamlSource, {lineWidth: 120})
            } catch {
                return ""
            }
        }, [isStringValue, parsedStructuredString, sanitizedSpanData])

        const textOutput = useMemo(() => {
            if (typeof sanitizedSpanData === "string") {
                return parsedStructuredString !== null
                    ? normalizeEscapedLineBreaks(sanitizedSpanData)
                    : sanitizedSpanData
            }
            return getStringOrJson(sanitizedSpanData)
        }, [parsedStructuredString, sanitizedSpanData])

        const availableViewModes = useMemo(() => {
            if (viewModePreset === "message") {
                const modes: RawSpanDisplayMode[] = ["text", "markdown"]
                if (
                    (isStringValue && parsedStructuredString !== null) ||
                    (!isStringValue && isObjectOrArrayValue)
                ) {
                    modes.push("rendered-json")
                }
                return modes
            }

            if (isStringValue) {
                if (parsedStructuredString !== null) {
                    const modes: RawSpanDisplayMode[] = ["json", "yaml", "rendered-json"]
                    modes.push("text", "markdown")
                    return modes
                }
                return ["text", "markdown"] as RawSpanDisplayMode[]
            }

            const modes: RawSpanDisplayMode[] = ["json", "yaml", "rendered-json"]
            return modes
        }, [viewModePreset, isStringValue, isObjectOrArrayValue, parsedStructuredString])
        const [viewMode, setViewMode] = useState<RawSpanDisplayMode>(() =>
            getDefaultRawSpanViewMode(availableViewModes),
        )

        const isCodeMode = viewMode === "json" || viewMode === "yaml"
        const isRenderedJson = viewMode === "rendered-json"

        const activeOutput =
            viewMode === "yaml" ? yamlOutput : viewMode === "json" ? jsonOutput : textOutput

        const closeSearch = useCallback(() => {
            setIsSearchOpen(false)
            setSearchTerm("")
            setResultCount(0)
            setCurrentResultIndex(0)
        }, [])

        const handleNextMatch = useCallback(() => {
            if (resultCount === 0) return
            setCurrentResultIndex((prev) => (prev + 1) % resultCount)
        }, [resultCount])

        const handlePrevMatch = useCallback(() => {
            if (resultCount === 0) return
            setCurrentResultIndex((prev) => (prev - 1 + resultCount) % resultCount)
        }, [resultCount])

        const toggleCollapsed = useCallback(() => {
            if (!allowSpanCollapse) return
            setIsCollapsed((prev) => {
                const next = !prev
                if (next) closeSearch()
                return next
            })
        }, [allowSpanCollapse, closeSearch])

        useEffect(() => {
            if (!availableViewModes.includes(viewMode)) {
                setViewMode(getDefaultRawSpanViewMode(availableViewModes))
            }
        }, [availableViewModes, viewMode])

        useEffect(() => {
            closeSearch()
        }, [activeOutput, closeSearch])

        useEffect(() => {
            if (!isCodeMode) {
                closeSearch()
            }
        }, [isCodeMode, closeSearch])

        const downloadFile = useCallback((url: string) => {
            const link = document.createElement("a")
            link.href = url
            link.download = ""
            link.click()
        }, [])
        const hasAttachments = Boolean(
            (fileAttachments?.length ?? 0) + (imageAttachments?.length ?? 0),
        )

        if (rootScope === "span") {
            const showTitle = Boolean(title)
            return (
                <div className="rounded-md overflow-hidden bg-white">
                    <div
                        className={`drill-in-field-header rounded-md flex items-center justify-between py-2 px-3 bg-white border border-solid border-[rgba(5,23,41,0.06)] ${allowSpanCollapse ? "cursor-pointer" : ""}`}
                        onClick={allowSpanCollapse ? toggleCollapsed : undefined}
                    >
                        <div className="flex items-center gap-2 text-gray-700 font-medium min-h-[16px]">
                            {allowSpanCollapse &&
                                (isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />)}
                            {showTitle ? <span>{title}</span> : null}
                        </div>
                        <div
                            className="flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Button
                                size="small"
                                type={isSearchOpen ? "primary" : "text"}
                                className={`${isSearchOpen ? "!bg-[#17324D] !border-[#17324D]" : "text-gray-500"} !px-1 !h-6 text-xs`}
                                icon={<MagnifyingGlassIcon size={14} />}
                                onClick={() => setIsSearchOpen((prev) => !prev)}
                                disabled={!isCodeMode}
                            />
                            <Select
                                size="small"
                                value={viewMode}
                                options={availableViewModes.map((mode) => ({
                                    label: RAW_SPAN_VIEW_MODE_LABELS[mode],
                                    value: mode,
                                }))}
                                onChange={(value) => setViewMode(value as RawSpanDisplayMode)}
                                className="min-w-[126px]"
                                popupMatchSelectWidth={false}
                            />
                            <CopyButton
                                text={activeOutput}
                                icon={true}
                                buttonText={null}
                                stopPropagation
                                size="small"
                            />
                        </div>
                    </div>
                    {(!allowSpanCollapse || !isCollapsed) && (
                        <div className="relative overflow-hidden">
                            {isSearchOpen && isCodeMode && (
                                <div className="absolute right-4 top-3 z-20 flex items-center gap-2 rounded-xl border border-[rgba(5,23,41,0.14)] bg-white px-2 py-2 shadow-[0_8px_24px_rgba(5,23,41,0.12)] max-w-[calc(100%-2rem)]">
                                    <Input
                                        className="w-[180px] min-w-[80px]"
                                        placeholder="Search..."
                                        value={searchTerm}
                                        onChange={(e) => {
                                            setSearchTerm(e.target.value)
                                            setCurrentResultIndex(0)
                                        }}
                                        onPressEnter={handleNextMatch}
                                        autoFocus
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowUpIcon size={14} />}
                                        onClick={handlePrevMatch}
                                        disabled={resultCount === 0}
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<ArrowDownIcon size={14} />}
                                        onClick={handleNextMatch}
                                        disabled={resultCount === 0}
                                    />
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<XIcon size={14} />}
                                        onClick={closeSearch}
                                    />
                                </div>
                            )}
                            {isCodeMode ? (
                                <DrillInProvider
                                    value={{
                                        enabled: false,
                                        decodeEscapedJsonStrings: false,
                                    }}
                                >
                                    <EditorProvider
                                        codeOnly
                                        enableTokens={false}
                                        showToolbar={false}
                                        readOnly
                                        disabled
                                        noProvider
                                    >
                                        <LanguageAwareViewer
                                            initialValue={activeOutput}
                                            language={viewMode}
                                            searchProps={
                                                isSearchOpen
                                                    ? {
                                                          searchTerm,
                                                          currentResultIndex,
                                                          onResultCountChange: setResultCount,
                                                      }
                                                    : undefined
                                            }
                                        />
                                    </EditorProvider>
                                </DrillInProvider>
                            ) : isRenderedJson ? (
                                <div className="overflow-y-auto">
                                    <RenderedJsonView
                                        data={sanitizedSpanData}
                                        keyPrefix={`trace-span-${textViewerId}`}
                                    />
                                </div>
                            ) : (
                                <div className="mx-1 my-2 rounded-md bg-[#F6F8FB]">
                                    <TextModeViewer
                                        editorId={`trace-span-${textViewerId}`}
                                        value={textOutput}
                                        mode={viewMode as "text" | "markdown"}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                    {(!allowSpanCollapse || !isCollapsed) && hasAttachments ? (
                        <div className="flex flex-col gap-2 mt-4">
                            <span className="tracking-wide">Attachments</span>
                            <div className="flex flex-wrap gap-2">
                                {(fileAttachments || [])?.map((file, index) => (
                                    <a
                                        key={`${file.data}-${index}`}
                                        className="group w-[80px] h-[60px] rounded border border-solid border-gray-200 bg-gray-100 px-2 pt-3 pb-2 hover:bg-gray-200 hover:scale-[1.02] cursor-pointer flex flex-col justify-between"
                                        href={file.data}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        <div className="w-full flex items-start gap-1">
                                            <FileTextIcon size={16} className="shrink-0" />
                                            <span className="text-[10px] truncate">
                                                {file.filename || `File ${index + 1}`}
                                            </span>
                                        </div>
                                        <div className="flex gap-1.5 shrink-0 invisible group-hover:visible">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<DownloadIcon size={10} />}
                                                className="!w-5 !h-5"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    downloadFile(file.data)
                                                }}
                                            />
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<CopyIcon size={10} />}
                                                className="!w-5 !h-5"
                                                onClick={(e) => {
                                                    e.preventDefault()
                                                    copyToClipboard(file.data)
                                                }}
                                            />
                                        </div>
                                    </a>
                                ))}

                                {(imageAttachments || [])?.map((image, index) => (
                                    <ImagePreview
                                        key={`${image.data}-${index}`}
                                        src={image.data}
                                        isValidPreview={true}
                                        alt={image.filename || `Image ${index + 1}`}
                                        size={80}
                                        className=""
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            )
        }

        // Type assertion needed because traceSpanMolecule.drillIn is optional in the general type
        // but we know it's configured for the trace entity
        const entityWithDrillIn = traceSpan as typeof traceSpanMolecule & {
            drillIn: NonNullable<typeof traceSpanMoleculeMolecule.drillIn>
        }

        return (
            <EntityDrillInView
                entityId={spanId}
                entity={entityWithDrillIn}
                // Trace-specific defaults
                rootTitle={title}
                editable={editable}
                showAddControls={false}
                showDeleteControls={false}
                // Navigation props
                breadcrumbPrefix={breadcrumbPrefix}
                showBackArrow={showBackArrow}
                initialPath={initialPath}
                focusPath={focusPath}
                onFocusPathHandled={onFocusPathHandled}
                onPropertyClick={onPropertyClick}
                // Column mapping props (for AddToTestsetDrawer integration)
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                mappedPaths={mappedPaths}
                // Display control props
                hideBreadcrumb={hideBreadcrumb}
                showFieldDrillIn={showFieldDrillIn}
                enableFieldViewModes={enableFieldViewModes}
                hideSingleFieldHeader={hideSingleFieldHeader}
                hideFieldHeaders={hideFieldHeaders}
                showFieldCollapse={showFieldCollapse}
            />
        )
    },
)

TraceSpanDrillInView.displayName = "TraceSpanDrillInView"
