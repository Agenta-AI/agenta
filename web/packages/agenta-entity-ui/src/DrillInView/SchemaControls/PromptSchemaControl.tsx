/**
 * PromptSchemaControl
 *
 * Schema-driven control for rendering prompt objects with message cards.
 * Matches the app playground UI with:
 * - Message cards with role dropdowns and rich text editors
 * - Variable token highlighting ({{variable}})
 * - Model config popover with LLM settings
 * - Action buttons (+ Message, + Tool, Output type, Template format)
 *
 * Detects prompt objects via:
 * - x-parameter: "prompt" in schema
 * - Object with "messages" property that is an array of role/content items
 */

import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {SimpleChatMessage} from "@agenta/shared/types"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Info, Plus} from "@phosphor-icons/react"
import {Alert, Button, Select} from "antd"
import {v4 as uuidv4} from "uuid"

import {ResponseFormatControl, type ResponseFormatValue} from "./ResponseFormatControl"
import {
    denormalizeMessages,
    getLLMConfigValue,
    getResponseFormatSchema,
    hasNestedLLMConfig,
    normalizeMessages,
    schemaSupportsTools,
} from "./schemaUtils"
import {buildTemplateFormatOptions, type TemplateFormat} from "./templateFormatOptions"
import {ToolItemControl} from "./ToolItemControl"
import {ToolSelectorPopover, type ToolSelectionMeta} from "./ToolSelectorPopover"
import {type ToolObj} from "./toolUtils"

export interface PromptSchemaControlProps {
    /** The schema property defining the prompt object */
    schema: SchemaProperty | null | undefined
    /** Display label for the field */
    label: string
    /** Current value (prompt object with messages, model, etc.) */
    value: Record<string, unknown> | null | undefined
    /** Change handler for the prompt object */
    onChange: (value: Record<string, unknown>) => void
    /** Optional description for the field */
    description?: string
    /** Disable all controls */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Template format for variable highlighting */
    templateFormat?: TemplateFormat
    /** Callback when template format changes (for syncing to entity) */
    onTemplateFormatChange?: (format: TemplateFormat) => void
    /** Available template variables for token highlighting */
    variables?: string[]
    /** Entity ID for response format modal state tracking */
    entityId?: string
    /** Hide the model selector (when it's shown elsewhere, e.g., in collapse header) */
    hideModelSelector?: boolean
    /** Optional renderer for provider icons in tool headers (receives provider key, returns icon element) */
    renderProviderIcon?: (providerKey: string) => React.ReactNode
}

/**
 * Check if a schema represents a prompt object.
 * Returns true if:
 * - Schema has x-parameter: "prompt"
 * - Schema is an object with "messages" property containing role/content items
 */
export function isPromptSchema(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    const xAgTypeRef = (schema as Record<string, unknown>)["x-ag-type-ref"] as string | undefined

    if (xAgTypeRef === "prompt-template") return true

    // Check for x-parameter: "prompt"
    const xParam = schema["x-parameter"] as string | undefined
    if (xParam === "prompt") return true

    // Check for object with messages property
    if (schema.type === "object" && schema.properties) {
        const props = schema.properties as Record<string, SchemaProperty>
        const messagesSchema = props.messages

        if (messagesSchema?.type === "array" && messagesSchema.items) {
            const itemSchema = messagesSchema.items as SchemaProperty
            if (itemSchema.type === "object" && itemSchema.properties) {
                const propNames = Object.keys(itemSchema.properties).map((k) => k.toLowerCase())
                // Must have role and content
                return propNames.includes("role") && propNames.includes("content")
            }
        }
    }

    return false
}

/**
 * Check if a value looks like a prompt object (runtime check).
 * Useful when schema is not available.
 */
export function isPromptValue(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false

    const obj = value as Record<string, unknown>
    const messages = obj.messages

    if (!Array.isArray(messages) || messages.length === 0) return false

    // Check if messages have role/content structure
    return messages.some(
        (msg) =>
            typeof msg === "object" &&
            msg !== null &&
            "role" in msg &&
            ("content" in msg || "tool_calls" in msg),
    )
}

const EMPTY_VARIABLES: string[] = []

/**
 * Default provider icon renderer using getProviderIcon from @agenta/ui
 */
function defaultRenderProviderIcon(providerKey: string): React.ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

function isBuiltinPayloadMatch(tool: unknown, payload: ToolObj): boolean {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false

    const toolObj = tool as Record<string, unknown>
    const payloadObj = payload as Record<string, unknown>

    if (typeof payloadObj.type === "string" && toolObj.type === payloadObj.type) return true
    if (typeof payloadObj.name === "string" && toolObj.name === payloadObj.name) return true

    const payloadKeys = Object.keys(payloadObj)
    return (
        payloadKeys.length === 1 &&
        payloadKeys[0] !== "type" &&
        payloadKeys[0] !== "name" &&
        payloadKeys[0] in toolObj
    )
}

/**
 * Schema-driven control for prompt objects.
 *
 * Renders the complete prompt UI matching the app playground:
 * - Model selector with config popover
 * - Message cards with role dropdowns and rich text editors
 * - Variable token highlighting
 * - Action buttons (+ Message, + Tool, Output type, Template format)
 *
 * @example
 * ```tsx
 * <PromptSchemaControl
 *   schema={promptSchema}
 *   label="Prompt"
 *   value={promptValue}
 *   onChange={(v) => dispatch({ type: 'setAtPath', path: ['prompt'], value: v })}
 *   variables={['country', 'language']}
 *   templateFormat="curly"
 * />
 * ```
 */
export const PromptSchemaControl = memo(function PromptSchemaControl({
    schema,
    label: _label,
    value,
    onChange,
    description: _description,
    disabled = false,
    className,
    templateFormat = "curly",
    onTemplateFormatChange,
    variables,
    entityId,
    hideModelSelector: _hideModelSelector = false,
    renderProviderIcon,
}: PromptSchemaControlProps) {
    // Get injected EditorProvider from context
    const {EditorProvider, gatewayTools} = useDrillInUI()

    // Use prop if provided, otherwise use default
    const effectiveRenderProviderIcon = renderProviderIcon ?? defaultRenderProviderIcon

    // Detect which key variant the value uses for template format (snake_case vs camelCase)
    const templateFormatKey = useMemo((): string => {
        if (!value) return "template_format"
        if ("template_format" in value) return "template_format"
        if ("templateFormat" in value) return "templateFormat"
        return "template_format"
    }, [value])

    // Read template format from value, falling back to prop
    const resolvedTemplateFormat = useMemo((): TemplateFormat => {
        if (!value) return templateFormat
        const raw = value.template_format ?? value.templateFormat
        if (raw === "mustache") return "mustache"
        if (raw === "fstring") return "fstring"
        if (raw === "jinja2" || raw === "jinja") return "jinja2"
        if (raw === "curly") return "curly"
        return templateFormat
    }, [value, templateFormat])

    // Local template format state (initialized from value or prop)
    const [localTemplateFormat, setLocalTemplateFormat] =
        useState<TemplateFormat>(resolvedTemplateFormat)

    // Sync local state when value changes externally (e.g., discard/revert)
    useEffect(() => {
        setLocalTemplateFormat(resolvedTemplateFormat)
    }, [resolvedTemplateFormat])

    // Sticky reference to the persisted format for THIS revision — the
    // user's escape hatch back to a legacy format while they have an
    // uncommitted draft.
    //
    // Reported by Kaosiso on 2026-06-01: switching `curly → mustache`
    // made the curly option vanish from the dropdown before the user had
    // committed anything; they couldn't switch back. Arda's clarification
    // in the follow-up DM: "until their config change" — i.e. curly
    // stays selectable WHILE the change is still a draft, and drops once
    // it's persisted.
    //
    // Implementation: capture the format at mount, then re-capture
    // whenever `entityId` changes. A commit produces a new revision with
    // a new entityId, so the ref naturally resets to the new
    // server-persisted format. Draft changes within the same revision
    // (which don't change entityId) leave the ref alone — that's the
    // escape-hatch window.
    const originalTemplateFormatRef = useRef<TemplateFormat>(resolvedTemplateFormat)
    const prevEntityIdRef = useRef<string | undefined>(entityId)
    useEffect(() => {
        if (entityId !== prevEntityIdRef.current) {
            // New revision — reset the escape hatch to the format that
            // was just persisted (now reflected in `resolvedTemplateFormat`).
            originalTemplateFormatRef.current = resolvedTemplateFormat
            prevEntityIdRef.current = entityId
        }
    }, [entityId, resolvedTemplateFormat])
    const stableVariables = variables ?? EMPTY_VARIABLES

    // Determine if llm_config is nested
    const isNestedLLMConfig = useMemo(() => hasNestedLLMConfig(schema), [schema])

    // Extract messages from value
    const messages = useMemo(() => {
        const raw = value?.messages
        if (!Array.isArray(raw)) return []
        return normalizeMessages(raw)
    }, [value?.messages])

    const hasMessagesField = useMemo(
        () => Boolean(value && typeof value === "object" && "messages" in value),
        [value],
    )

    // Get LLM config value (handles nested vs root level)
    const llmConfigValue = useMemo(() => getLLMConfigValue(value), [value])

    // Extract response format value from llm_config (full object with type and json_schema)
    const responseFormatValue = useMemo((): ResponseFormatValue | null => {
        const rf = llmConfigValue?.response_format || llmConfigValue?.responseFormat
        if (typeof rf === "object" && rf !== null) {
            return rf as ResponseFormatValue
        }
        if (typeof rf === "string") {
            return {type: rf as ResponseFormatValue["type"]}
        }
        return null
    }, [llmConfigValue])

    const responseFormatSchema = useMemo(() => getResponseFormatSchema(schema), [schema])

    // Check if schema declares tools support
    const hasTools = useMemo(() => schemaSupportsTools(schema), [schema])

    // Check if response format exists and should be shown
    // If responseFormatSchema is null/empty, don't show the response format control
    // (evaluators have feedback_config as a separate top-level section)
    const hasResponseFormat = useMemo(() => {
        return !!responseFormatSchema && Object.keys(responseFormatSchema).length > 0
    }, [responseFormatSchema])

    // Handle messages change
    const handleMessagesChange = useCallback(
        (newMessages: SimpleChatMessage[]) => {
            onChange({
                ...value,
                messages: denormalizeMessages(newMessages),
            })
        },
        [value, onChange],
    )

    // Detect nested llm_config from both schema AND value
    // (schema may not declare it but the value can still have it)
    const hasNestedLLMConfigValue = useMemo(
        () => isNestedLLMConfig || !!(value?.llm_config || value?.llmConfig),
        [isNestedLLMConfig, value],
    )

    // Handle response format change (respects nested llm_config structure)
    // Accepts full ResponseFormatValue object with type and optional json_schema
    const handleResponseFormatChange = useCallback(
        (newFormat: ResponseFormatValue) => {
            if (hasNestedLLMConfigValue) {
                const llmConfigKey = value?.llm_config ? "llm_config" : "llmConfig"
                const currentLLMConfig = (value?.[llmConfigKey] || {}) as Record<string, unknown>
                onChange({
                    ...value,
                    [llmConfigKey]: {
                        ...currentLLMConfig,
                        response_format: newFormat,
                    },
                })
            } else {
                onChange({
                    ...value,
                    response_format: newFormat,
                })
            }
        },
        [value, onChange, hasNestedLLMConfigValue],
    )

    // Handle add message
    const handleAddMessage = useCallback(() => {
        const newMessage: SimpleChatMessage = {
            id: uuidv4(),
            role: "user",
            content: "",
        }
        handleMessagesChange([...messages, newMessage])
    }, [messages, handleMessagesChange])

    // Helper: get the current tools array from the correct location
    const getToolsArray = useCallback((): unknown[] => {
        const raw = hasNestedLLMConfigValue ? llmConfigValue?.tools : value?.tools
        return Array.isArray(raw) ? (raw as unknown[]) : []
    }, [hasNestedLLMConfigValue, llmConfigValue, value])

    // Helper: write tools to the correct location (respects nested llm_config)
    const setToolsValue = useCallback(
        (newTools: unknown[] | undefined) => {
            if (hasNestedLLMConfigValue) {
                const llmConfigKey = value?.llm_config ? "llm_config" : "llmConfig"
                const currentLLMConfig = (value?.[llmConfigKey] || {}) as Record<string, unknown>
                onChange({
                    ...value,
                    [llmConfigKey]: {
                        ...currentLLMConfig,
                        tools: newTools,
                    },
                })
            } else {
                onChange({
                    ...value,
                    tools: newTools,
                })
            }
        },
        [value, onChange, hasNestedLLMConfigValue],
    )

    // Handle add tool (from ToolSelectorPopover)
    // Preserve tool source metadata so the card renderer can recover the
    // richer gateway/builtin header presentation after serialization.
    const handleAddTool = useCallback(
        (newTool: ToolObj, meta?: ToolSelectionMeta) => {
            const currentTools = getToolsArray()
            if (!newTool || typeof newTool !== "object" || Array.isArray(newTool)) {
                setToolsValue([...currentTools, newTool])
                return
            }

            const nextTool = meta
                ? {
                      ...(newTool as Record<string, unknown>),
                      agenta_metadata: {
                          ...(((newTool as Record<string, unknown>).agenta_metadata as
                              | Record<string, unknown>
                              | undefined) ?? {}),
                          ...meta,
                      },
                  }
                : newTool

            setToolsValue([...currentTools, nextTool])
        },
        [getToolsArray, setToolsValue],
    )

    // Extract tools array from value (respects nested llm_config)
    const tools = useMemo(() => getToolsArray(), [getToolsArray])

    const selectedToolNames = useMemo(() => {
        return new Set(
            tools
                .map((tool) => {
                    if (!tool || typeof tool !== "object") return undefined
                    const fn = (tool as Record<string, unknown>).function
                    if (!fn || typeof fn !== "object") return undefined
                    const name = (fn as Record<string, unknown>).name
                    return typeof name === "string" ? name : undefined
                })
                .filter((name): name is string => Boolean(name)),
        )
    }, [tools])

    // Handle individual tool change
    const handleToolChange = useCallback(
        (index: number, newToolValue: ToolObj) => {
            const currentTools = getToolsArray()
            const updated = [...currentTools]
            updated[index] = newToolValue
            setToolsValue(updated)
        },
        [getToolsArray, setToolsValue],
    )

    // Handle tool deletion
    const handleToolDelete = useCallback(
        (index: number) => {
            const currentTools = getToolsArray()
            const updated = currentTools.filter((_, i) => i !== index)
            setToolsValue(updated.length > 0 ? updated : undefined)
        },
        [getToolsArray, setToolsValue],
    )

    const handleRemoveToolByName = useCallback(
        (toolName: string) => {
            const currentTools = getToolsArray()
            const updated = currentTools.filter((tool) => {
                if (!tool || typeof tool !== "object") return true
                const fn = (tool as Record<string, unknown>).function
                if (!fn || typeof fn !== "object") return true
                return (fn as Record<string, unknown>).name !== toolName
            })
            setToolsValue(updated.length > 0 ? updated : undefined)
        },
        [getToolsArray, setToolsValue],
    )

    const handleRemoveBuiltinTool = useCallback(
        (toolToRemove: ToolObj) => {
            const currentTools = getToolsArray()
            let removed = false
            const updated = currentTools.filter((tool) => {
                if (removed) return true
                const matches = isBuiltinPayloadMatch(tool, toolToRemove)
                if (matches) {
                    removed = true
                    return false
                }
                return true
            })
            setToolsValue(updated.length > 0 ? updated : undefined)
        },
        [getToolsArray, setToolsValue],
    )

    // Handle tool duplication
    const handleToolDuplicate = useCallback(
        (index: number) => {
            const currentTools = getToolsArray()
            const toolToDuplicate = currentTools[index]
            if (!toolToDuplicate) return
            const duplicated = JSON.parse(JSON.stringify(toolToDuplicate))
            const updated = [...currentTools]
            updated.splice(index + 1, 0, duplicated)
            setToolsValue(updated)
        },
        [getToolsArray, setToolsValue],
    )

    if (!hasMessagesField) {
        return <div className={cn("min-h-[260px]", className)} />
    }

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            {/* Messages list */}
            <ChatMessageList
                messages={messages}
                onChange={handleMessagesChange}
                disabled={disabled}
                showControls={false}
                showRemoveButton={true}
                showCopyButton={true}
                allowFileUpload={false}
                placeholder="Enter message content..."
                className="[&_.chat-message-editor]:border [&_.chat-message-editor]:border-zinc-2 [&_.chat-message-editor]:rounded-lg"
                enableTokens={true}
                templateFormat={localTemplateFormat}
                tokens={stableVariables}
                loadingFallback="static"
                viewModes={["text", "markdown"]}
            />

            {/* Tools list */}
            {tools.length > 0 && (
                <div className="flex flex-col gap-2">
                    {tools.map((tool, index) => {
                        const toolControl = (
                            <ToolItemControl
                                key={`tool-${index}`}
                                value={tool}
                                onChange={(newValue) => handleToolChange(index, newValue)}
                                onDelete={disabled ? undefined : () => handleToolDelete(index)}
                                onDuplicate={
                                    disabled ? undefined : () => handleToolDuplicate(index)
                                }
                                disabled={disabled}
                                renderProviderIcon={effectiveRenderProviderIcon}
                            />
                        )

                        if (!EditorProvider) return toolControl

                        return (
                            <EditorProvider
                                key={`tool-editor-${index}`}
                                codeOnly
                                language="json"
                                showToolbar={false}
                                enableTokens={false}
                                id={`tool-editor-${index}`}
                            >
                                {toolControl}
                            </EditorProvider>
                        )
                    })}
                </div>
            )}

            {/* Action bar - Message, Tool, Output type, Template format */}
            {!disabled && (
                <div className="flex flex-wrap gap-1">
                    {/* Add Message */}
                    <Button
                        variant="outlined"
                        color="default"
                        size="small"
                        icon={<Plus size={14} />}
                        onClick={handleAddMessage}
                    >
                        Message
                    </Button>

                    {/* Add Tool — only when schema declares tools support */}
                    {hasTools && (
                        <ToolSelectorPopover
                            onAddTool={handleAddTool}
                            onRemoveTool={handleRemoveToolByName}
                            onRemoveBuiltinTool={handleRemoveBuiltinTool}
                            selectedToolNames={selectedToolNames}
                            selectedTools={tools as ToolObj[]}
                            disabled={disabled}
                            renderProviderIcon={effectiveRenderProviderIcon}
                            existingToolCount={tools.length}
                            gatewayTools={gatewayTools}
                        />
                    )}

                    {/* Output type (response format) with JSON schema editing */}
                    {/* Only show if responseFormatSchema exists (evaluators have feedback_config as separate section) */}
                    {hasResponseFormat && (
                        <ResponseFormatControl
                            controlId={entityId || "response-format"}
                            schema={responseFormatSchema}
                            value={responseFormatValue}
                            onChange={handleResponseFormatChange}
                            disabled={disabled}
                            size="small"
                        />
                    )}

                    {/* Template format */}
                    <Select
                        size="small"
                        value={localTemplateFormat}
                        onChange={(val) => {
                            const format = val as TemplateFormat
                            setLocalTemplateFormat(format)
                            onTemplateFormatChange?.(format)
                            // Propagate to entity draft via onChange
                            onChange({
                                ...value,
                                [templateFormatKey]: format,
                            })
                        }}
                        options={buildTemplateFormatOptions(
                            localTemplateFormat,
                            originalTemplateFormatRef.current,
                        )}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                        style={{height: 24}}
                    />
                </div>
            )}

            {/* One-way migration warning for legacy formats. Surfaces ONLY
             *  while the user has:
             *    1. an original (server-persisted) format of `curly` or
             *       `fstring` — the two legacy formats hidden from the
             *       picker for new prompts, and
             *    2. picked a non-legacy alternative in the dropdown
             *       (`localTemplateFormat !== original`), and
             *    3. not yet committed the draft (the original ref is
             *       sticky for the lifetime of THIS revision — once the
             *       draft commits, a new revision is loaded and the ref
             *       resets to the now-persisted non-legacy format,
             *       legitimately dropping curly/fstring from the picker).
             *
             *  Placed BELOW the action bar so toggling visibility doesn't
             *  push the action-bar buttons downward — users picking the
             *  format wouldn't lose their click target as the banner
             *  appears/disappears.
             *
             *  So the banner is the actionable window: "you can still
             *  bail by discarding". Once committed, it disappears with
             *  the legacy option itself. */}
            {!disabled &&
                (originalTemplateFormatRef.current === "curly" ||
                    originalTemplateFormatRef.current === "fstring") &&
                localTemplateFormat !== originalTemplateFormatRef.current && (
                    <Alert
                        type="info"
                        showIcon
                        icon={<Info size={14} />}
                        className="!py-1 !px-2 !rounded-md"
                        message={
                            <span className="text-[12px]">
                                Switching from{" "}
                                <code className="font-mono text-[11px] bg-[#e6f4ff] px-1 rounded">
                                    {originalTemplateFormatRef.current}
                                </code>{" "}
                                is permanent — once you commit, you won&apos;t be able to switch
                                back. Discard the draft to revert.
                            </span>
                        }
                    />
                )}
        </div>
    )
})
