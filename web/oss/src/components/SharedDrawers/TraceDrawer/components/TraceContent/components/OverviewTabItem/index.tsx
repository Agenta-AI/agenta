import {useMemo, useState} from "react"

import {Space} from "antd"
import {useAtomValue} from "jotai"
import {CaretDown, CaretRight} from "@phosphor-icons/react"

import {TraceSpanDrillInView} from "@/oss/components/DrillInView"
import ResultTag from "@/oss/components/ResultTag/ResultTag"
import {getStringOrJson} from "@/oss/lib/helpers/utils"
import {TraceSpanNode} from "@/oss/services/tracing/types"
import {traceSpan} from "@/oss/state/entities/trace"
import {
    spanDataInputsAtomFamily,
    spanDataInternalsAtomFamily,
    spanDataOutputsAtomFamily,
    spanExceptionAtomFamily,
    spanMetaConfigurationAtomFamily,
    spanNodeTypeAtomFamily,
} from "@/oss/state/newObservability/selectors/tracing"

import AccordionTreePanel from "../../../AccordionTreePanel"

interface RoleMessage {
    role?: string
    content?: unknown
    contents?: {message_content?: {text?: string}}[]
    tool_calls?: unknown[]
    tool_call_id?: string
    name?: string
    [key: string]: unknown
}

interface MessageGroup {
    key: string
    path: string[]
    messages: RoleMessage[]
}

// ============================================================================
// Content block types (Anthropic multi-modal format)
// ============================================================================

interface ContentBlock {
    type: string
    text?: string
    thinking?: string
    id?: string
    name?: string
    input?: unknown
    [key: string]: unknown
}

interface OpenAIToolCall {
    id?: string
    type?: string
    function?: {
        name?: string
        arguments?: string | Record<string, unknown>
    }
    name?: string
    input?: unknown
}

interface ParsedContentBlocks {
    textParts: string[]
    thinkingParts: string[]
    toolUseParts: {id?: string; name?: string; args?: unknown}[]
}

// ============================================================================
// Complex content helpers
// ============================================================================

const isContentBlockArray = (content: unknown): content is ContentBlock[] => {
    if (!Array.isArray(content) || content.length === 0) return false
    return content.some(
        (b) => b && typeof b === "object" && typeof (b as Record<string, unknown>).type === "string",
    )
}

const parseContentBlocks = (content: unknown): ParsedContentBlocks | null => {
    if (!isContentBlockArray(content)) return null

    const result: ParsedContentBlocks = {textParts: [], thinkingParts: [], toolUseParts: []}

    for (const block of content) {
        if (block.type === "thinking" && typeof block.thinking === "string") {
            result.thinkingParts.push(block.thinking)
        } else if (block.type === "text" && typeof block.text === "string") {
            result.textParts.push(block.text)
        } else if (block.type === "tool_use") {
            result.toolUseParts.push({
                id: typeof block.id === "string" ? block.id : undefined,
                name: typeof block.name === "string" ? block.name : undefined,
                args: block.input,
            })
        }
    }

    return result
}

const getOpenAIToolCalls = (message: RoleMessage): OpenAIToolCall[] => {
    if (!Array.isArray(message.tool_calls)) return []
    return message.tool_calls as OpenAIToolCall[]
}

const hasComplexMessageContent = (message: RoleMessage): boolean => {
    if (Array.isArray(message.content)) {
        const parsed = parseContentBlocks(message.content)
        if (parsed && (parsed.thinkingParts.length > 0 || parsed.toolUseParts.length > 0)) {
            return true
        }
    }
    return getOpenAIToolCalls(message).length > 0
}

const formatToolArgs = (args: unknown): string => {
    if (args === null || args === undefined) return "{}"
    if (typeof args === "string") {
        try {
            return JSON.stringify(JSON.parse(args), null, 2)
        } catch {
            return args
        }
    }
    try {
        return JSON.stringify(args, null, 2)
    } catch {
        return String(args)
    }
}

// Format gateway tool slugs: tools__provider__integration__action__connection
const formatToolName = (name: string | undefined): string => {
    if (!name) return "tool"
    const parts = name.split("__")
    if (parts.length === 5 && parts[0] === "tools") {
        return `${parts[2]} / ${parts[3]} / ${parts[4]}`
    }
    return name
}

// ============================================================================
// Sub-components
// ============================================================================

const ReasoningSection = ({parts}: {parts: string[]}) => {
    const [isExpanded, setIsExpanded] = useState(false)
    const fullText = parts.join("\n\n")
    const preview = fullText.slice(0, 100)

    return (
        <div className="rounded-md border border-[#FFE4AA] bg-[#FFFDF0] overflow-hidden">
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-[#FFF8DC] transition-colors cursor-pointer border-0 bg-transparent"
            >
                {isExpanded ? (
                    <CaretDown size={12} className="text-[#92610C] shrink-0" />
                ) : (
                    <CaretRight size={12} className="text-[#92610C] shrink-0" />
                )}
                <span className="text-xs font-semibold text-[#92610C]">Reasoning</span>
                {!isExpanded && (
                    <span className="text-xs text-[#B5851A] opacity-70 truncate">
                        {preview}
                        {fullText.length > 100 ? "…" : ""}
                    </span>
                )}
            </button>
            {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-[#FFE4AA]">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap break-words font-sans leading-relaxed m-0">
                        {fullText}
                    </pre>
                </div>
            )}
        </div>
    )
}

const ToolCallRow = ({
    name,
    callId,
    args,
}: {
    name?: string
    callId?: string
    args?: unknown
}) => {
    const displayName = formatToolName(name)
    const formattedArgs = formatToolArgs(args)

    return (
        <div className="rounded-md border border-[#C2D6EE] bg-[#F0F7FF] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2">
                <span
                    className="font-mono text-xs font-semibold text-[#0D5BA3]"
                    title={name !== displayName ? name : undefined}
                >
                    {displayName}
                </span>
                {callId && (
                    <span
                        className="text-[10px] text-gray-400 font-mono truncate max-w-[200px]"
                        title={callId}
                    >
                        {callId}
                    </span>
                )}
            </div>
            <div className="border-t border-[#C2D6EE] px-3 py-2">
                <pre className="text-xs text-gray-700 overflow-auto max-h-[240px] font-mono leading-relaxed m-0">
                    {formattedArgs}
                </pre>
            </div>
        </div>
    )
}

/** Renders a message that contains reasoning blocks and/or tool calls */
const ComplexMessagePanel = ({
    message,
    keyPrefix,
    bgColor,
}: {
    message: RoleMessage
    keyPrefix: string
    bgColor?: string
}) => {
    const role = message.role || "assistant"

    // Parse Anthropic-style content blocks
    const parsedBlocks = Array.isArray(message.content) ? parseContentBlocks(message.content) : null

    // Text content: from parsed blocks or plain string
    const textContent =
        parsedBlocks && parsedBlocks.textParts.length > 0
            ? parsedBlocks.textParts.join("\n")
            : typeof message.content === "string"
              ? message.content
              : null

    const thinkingParts = parsedBlocks?.thinkingParts ?? []

    // Tool calls: Anthropic tool_use blocks + OpenAI tool_calls
    const toolCalls: {id?: string; name?: string; args?: unknown}[] = [
        ...(parsedBlocks?.toolUseParts ?? []),
        ...getOpenAIToolCalls(message).map((tc) => ({
            id: tc.id,
            name: tc.function?.name ?? (typeof tc.name === "string" ? tc.name : undefined),
            args: tc.function?.arguments ?? tc.input,
        })),
    ]

    return (
        <div
            className="rounded-md border border-[rgba(5,23,41,0.06)] overflow-hidden"
            style={{backgroundColor: bgColor || "#fff"}}
        >
            {/* Role header */}
            <div className="flex items-center px-3 py-2 border-b border-[rgba(5,23,41,0.06)] bg-white">
                <span className="text-xs font-medium capitalize text-gray-700">{role}</span>
                {message.tool_call_id && (
                    <span
                        className="ml-2 text-[10px] font-mono text-gray-400 truncate max-w-[240px]"
                        title={String(message.tool_call_id)}
                    >
                        {String(message.tool_call_id)}
                    </span>
                )}
            </div>

            {/* Content area */}
            <div className="flex flex-col gap-2 p-3">
                {/* Reasoning blocks (Anthropic thinking) */}
                {thinkingParts.length > 0 && (
                    <ReasoningSection key={`${keyPrefix}-reasoning`} parts={thinkingParts} />
                )}

                {/* Text content */}
                {textContent && (
                    <div className="text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                        {textContent}
                    </div>
                )}

                {/* Tool call rows */}
                {toolCalls.length > 0 && (
                    <div className="flex flex-col gap-2">
                        {toolCalls.map((tc, idx) => (
                            <ToolCallRow
                                key={`${keyPrefix}-tool-${idx}`}
                                name={tc.name}
                                callId={tc.id}
                                args={tc.args}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// ============================================================================
// Message group collection helpers
// ============================================================================

const MESSAGE_KEY_HINTS = new Set(["messages", "prompt", "completion"])

const isNullish = (value: unknown) => value === null || value === undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value)

const isMessageLike = (value: unknown): value is RoleMessage => {
    if (!isRecord(value)) return false

    const hasRole = typeof value.role === "string"
    const hasContent = value.content !== undefined
    const hasMessageContentText =
        Array.isArray(value.contents) &&
        value.contents.some((item) => item?.message_content?.text !== undefined)

    return hasRole || hasContent || hasMessageContentText
}

const isMessageArray = (value: unknown, keyHint = false): value is RoleMessage[] =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isMessageLike) &&
    (keyHint || value.some((item) => typeof item.role === "string"))

const collectMessageGroups = (value: unknown, baseKey: string): MessageGroup[] => {
    const groups: MessageGroup[] = []
    const visited = new Set<unknown>()
    const seenPaths = new Set<string>()

    const walk = (current: unknown, path: string[]) => {
        if (!current || typeof current !== "object") return
        if (visited.has(current)) return
        visited.add(current)

        if (Array.isArray(current)) {
            const leaf = path[path.length - 1]?.toLowerCase()
            const keyHint = leaf ? MESSAGE_KEY_HINTS.has(leaf) : false
            if (isMessageArray(current, keyHint)) {
                const serializedPath = path.join(".")
                if (!seenPaths.has(serializedPath)) {
                    seenPaths.add(serializedPath)
                    groups.push({
                        key: `${baseKey}.${serializedPath || "root"}`,
                        path,
                        messages: current,
                    })
                }
                return
            }

            current.forEach((item, index) => walk(item, [...path, String(index)]))
            return
        }

        Object.entries(current).forEach(([key, nested]) => walk(nested, [...path, key]))
    }

    walk(value, [])
    return groups
}

const deleteAtPath = (target: unknown, path: string[]) => {
    if (!path.length || !target || typeof target !== "object") return

    const removeAtSegment = (container: unknown, segment: string): boolean => {
        if (Array.isArray(container)) {
            const index = Number(segment)
            if (
                Number.isInteger(index) &&
                String(index) === segment &&
                index >= 0 &&
                index < container.length
            ) {
                container.splice(index, 1)
                return true
            }
        }

        if (container && typeof container === "object" && segment in container) {
            delete (container as Record<string, unknown>)[segment]
            return true
        }

        return false
    }

    const isEmptyContainer = (value: unknown) =>
        (Array.isArray(value) && value.length === 0) ||
        (isRecord(value) && Object.keys(value).length === 0)

    const ancestors: {parent: unknown; segment: string}[] = []
    let cursor: any = target

    for (let index = 0; index < path.length - 1; index += 1) {
        const segment = path[index]
        if (!cursor || typeof cursor !== "object" || !(segment in cursor)) return
        ancestors.push({parent: cursor, segment})
        cursor = cursor[segment]
    }

    const lastSegment = path[path.length - 1]
    if (!removeAtSegment(cursor, lastSegment)) return

    // Prune only containers emptied by this delete path.
    for (let index = ancestors.length - 1; index >= 0; index -= 1) {
        const {parent, segment} = ancestors[index]
        const child = (parent as any)?.[segment]
        if (!isEmptyContainer(child)) break
        removeAtSegment(parent, segment)
    }
}

const removeMessageGroupsFromData = (value: unknown, groups: MessageGroup[]): unknown => {
    if (!groups.length || isNullish(value)) return value
    if (groups.some((group) => group.path.length === 0)) return undefined

    let cloned: any
    try {
        cloned = structuredClone(value)
    } catch {
        return value
    }

    groups.forEach((group) => deleteAtPath(cloned, group.path))

    if (
        (Array.isArray(cloned) && cloned.length === 0) ||
        (isRecord(cloned) && Object.keys(cloned).length === 0)
    ) {
        return undefined
    }

    return cloned
}

const getMessageContent = (message: RoleMessage): unknown => {
    if (message?.content !== undefined) return message.content
    if (
        message?.contents &&
        Array.isArray(message.contents) &&
        message.contents.length === 1 &&
        message.contents[0]?.message_content?.text !== undefined
    ) {
        return message.contents[0].message_content.text
    }
    return undefined
}

// ============================================================================
// Main component
// ============================================================================

const OverviewTabItem = ({activeTrace}: {activeTrace: TraceSpanNode}) => {
    // Use trace drill-in API for data access while preserving existing UI rendering.
    const entityWithDrillIn = traceSpan as typeof traceSpan & {
        drillIn: NonNullable<typeof traceSpan.drillIn>
    }
    const metaConfig = useAtomValue(spanMetaConfigurationAtomFamily(activeTrace))
    const inputsFromSelectors = useAtomValue(spanDataInputsAtomFamily(activeTrace))
    const outputsFromSelectors = useAtomValue(spanDataOutputsAtomFamily(activeTrace))
    const internalsFromSelectors = useAtomValue(spanDataInternalsAtomFamily(activeTrace))
    const nodeType = useAtomValue(spanNodeTypeAtomFamily(activeTrace))
    const exception = useAtomValue(spanExceptionAtomFamily(activeTrace))

    const {inputs, outputs, internals} = useMemo(
        () => ({
            inputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "inputs"]) ??
                inputsFromSelectors,
            outputs:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, ["ag", "data", "outputs"]) ??
                outputsFromSelectors,
            internals:
                entityWithDrillIn.drillIn.getValueAtPath(activeTrace, [
                    "ag",
                    "data",
                    "internals",
                ]) ?? internalsFromSelectors,
        }),
        [
            activeTrace,
            entityWithDrillIn,
            inputsFromSelectors,
            outputsFromSelectors,
            internalsFromSelectors,
        ],
    )
    const spanEntityId =
        activeTrace?.span_id || activeTrace?.invocationIds?.span_id || activeTrace?.key
    const isChatSpan = activeTrace?.span_type === "chat" || nodeType === "chat"
    const isEmbeddingSpan = activeTrace?.span_type === "embedding"
    const shouldRenderMessagePanels = isChatSpan && !isEmbeddingSpan
    const {inputMessageGroups, outputMessageGroups, inputsPanelValue, outputsPanelValue} =
        useMemo(() => {
            if (!shouldRenderMessagePanels) {
                return {
                    inputMessageGroups: [] as MessageGroup[],
                    outputMessageGroups: [] as MessageGroup[],
                    inputsPanelValue: inputs,
                    outputsPanelValue: outputs,
                }
            }

            const nextInputMessageGroups = collectMessageGroups(inputs, "inputs")
            const nextOutputMessageGroups = collectMessageGroups(outputs, "outputs")

            return {
                inputMessageGroups: nextInputMessageGroups,
                outputMessageGroups: nextOutputMessageGroups,
                inputsPanelValue: removeMessageGroupsFromData(inputs, nextInputMessageGroups),
                outputsPanelValue: removeMessageGroupsFromData(outputs, nextOutputMessageGroups),
            }
        }, [inputs, outputs, shouldRenderMessagePanels])

    return (
        <div className="w-full flex flex-col gap-2">
            {metaConfig && (
                <Space style={{flexWrap: "wrap"}}>
                    {Object.entries(metaConfig)
                        .filter(([key]) =>
                            [
                                "model",
                                "temperature",
                                "base_url",
                                "top_p",
                                "max_output_tokens",
                            ].includes(key),
                        )
                        .map(([key, value], index) => (
                            <ResultTag key={index} value1={key} value2={getStringOrJson(value)} />
                        ))}
                </Space>
            )}

            {inputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {!isNullish(inputsPanelValue) &&
                        (spanEntityId ? (
                            <TraceSpanDrillInView
                                spanId={spanEntityId}
                                title="inputs"
                                editable={false}
                                rootScope="span"
                                spanDataOverride={inputsPanelValue}
                            />
                        ) : (
                            <AccordionTreePanel
                                label={"inputs"}
                                value={inputsPanelValue as any}
                                enableFormatSwitcher
                            />
                        ))}
                    {inputMessageGroups.length > 0 && (
                        <Space orientation="vertical" className="w-full" size={12}>
                            {inputMessageGroups.map((group) =>
                                group.messages.map((message, index) => {
                                    const msgKey = `${group.key}-input-message-${index}`

                                    // Complex message: has reasoning blocks or tool calls
                                    if (hasComplexMessageContent(message)) {
                                        return (
                                            <ComplexMessagePanel
                                                key={msgKey}
                                                message={message}
                                                keyPrefix={msgKey}
                                            />
                                        )
                                    }

                                    const content = getMessageContent(message)
                                    if (content !== undefined) {
                                        if (spanEntityId) {
                                            return (
                                                <TraceSpanDrillInView
                                                    key={msgKey}
                                                    spanId={spanEntityId}
                                                    title={message.role || "message"}
                                                    editable={false}
                                                    rootScope="span"
                                                    viewModePreset="message"
                                                    spanDataOverride={content}
                                                />
                                            )
                                        }

                                        return (
                                            <AccordionTreePanel
                                                key={msgKey}
                                                label={message.role || "message"}
                                                value={content}
                                                enableFormatSwitcher
                                                viewModePreset="message"
                                            />
                                        )
                                    }

                                    const {role, ...messageWithoutRole} = message
                                    if (spanEntityId) {
                                        return (
                                            <TraceSpanDrillInView
                                                key={msgKey}
                                                spanId={spanEntityId}
                                                title={role || "message"}
                                                editable={false}
                                                rootScope="span"
                                                viewModePreset="message"
                                                spanDataOverride={messageWithoutRole}
                                            />
                                        )
                                    }

                                    return (
                                        <AccordionTreePanel
                                            key={msgKey}
                                            label={role || "message"}
                                            value={messageWithoutRole}
                                            enableFormatSwitcher
                                            viewModePreset="message"
                                        />
                                    )
                                }),
                            )}
                        </Space>
                    )}
                </Space>
            ) : null}

            {outputs ? (
                <Space orientation="vertical" className="w-full" size={24}>
                    {!isNullish(outputsPanelValue) &&
                        (spanEntityId ? (
                            <TraceSpanDrillInView
                                spanId={spanEntityId}
                                title="outputs"
                                editable={false}
                                rootScope="span"
                                spanDataOverride={outputsPanelValue}
                            />
                        ) : (
                            <AccordionTreePanel
                                label={"outputs"}
                                value={outputsPanelValue as any}
                                enableFormatSwitcher
                            />
                        ))}
                    {outputMessageGroups.length > 0 && (
                        <Space orientation="vertical" className="w-full" size={12}>
                            {outputMessageGroups.map((group) =>
                                group.messages.map((message, index) => {
                                    const msgKey = `${group.key}-output-message-${index}`

                                    // Complex message: has reasoning blocks or tool calls
                                    if (hasComplexMessageContent(message)) {
                                        return (
                                            <ComplexMessagePanel
                                                key={msgKey}
                                                message={message}
                                                keyPrefix={msgKey}
                                                bgColor="#E6FFFB"
                                            />
                                        )
                                    }

                                    const content = getMessageContent(message)
                                    if (content !== undefined) {
                                        if (spanEntityId) {
                                            return (
                                                <TraceSpanDrillInView
                                                    key={msgKey}
                                                    spanId={spanEntityId}
                                                    title={message.role || "assistant"}
                                                    editable={false}
                                                    rootScope="span"
                                                    viewModePreset="message"
                                                    spanDataOverride={content}
                                                />
                                            )
                                        }

                                        return (
                                            <AccordionTreePanel
                                                key={msgKey}
                                                label={message.role || "assistant"}
                                                value={content}
                                                enableFormatSwitcher
                                                viewModePreset="message"
                                                bgColor="#E6FFFB"
                                            />
                                        )
                                    }

                                    const {role, ...messageWithoutRole} = message
                                    if (spanEntityId) {
                                        return (
                                            <TraceSpanDrillInView
                                                key={msgKey}
                                                spanId={spanEntityId}
                                                title={role || "assistant"}
                                                editable={false}
                                                rootScope="span"
                                                viewModePreset="message"
                                                spanDataOverride={messageWithoutRole}
                                            />
                                        )
                                    }

                                    return (
                                        <AccordionTreePanel
                                            key={msgKey}
                                            label={role || "assistant"}
                                            value={messageWithoutRole}
                                            enableFormatSwitcher
                                            viewModePreset="message"
                                            bgColor="#E6FFFB"
                                        />
                                    )
                                }),
                            )}
                        </Space>
                    )}
                </Space>
            ) : null}

            {internals && (
                <Space orientation="vertical" className="w-full" size={24}>
                    {nodeType !== "chat" && (
                        <>
                            {spanEntityId ? (
                                <TraceSpanDrillInView
                                    spanId={spanEntityId}
                                    title="internals"
                                    editable={false}
                                    rootScope="span"
                                    spanDataOverride={internals}
                                />
                            ) : (
                                <AccordionTreePanel
                                    label={"internals"}
                                    value={internals}
                                    enableFormatSwitcher
                                />
                            )}
                        </>
                    )}
                </Space>
            )}

            {exception && (
                <Space orientation="vertical" className="w-full" size={24}>
                    <AccordionTreePanel
                        label={"Exception"}
                        value={exception}
                        enableFormatSwitcher
                        bgColor="#FBE7E7"
                    />
                </Space>
            )}
        </div>
    )
}

export default OverviewTabItem
