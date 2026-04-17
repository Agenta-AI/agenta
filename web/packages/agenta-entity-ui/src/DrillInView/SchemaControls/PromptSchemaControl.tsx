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

import {memo, useCallback, useEffect, useMemo, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {SimpleChatMessage} from "@agenta/shared/types"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"
import {Button, Input, Select, Typography} from "antd"
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
    templateFormat?: "curly" | "fstring" | "jinja2"
    /** Callback when template format changes (for syncing to entity) */
    onTemplateFormatChange?: (format: "curly" | "fstring" | "jinja2") => void
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

// Template format options
const TEMPLATE_FORMAT_OPTIONS = [
    {label: "Prompt Syntax: Curly", value: "curly"},
    {label: "Prompt Syntax: F-string", value: "fstring"},
    {label: "Prompt Syntax: Jinja2", value: "jinja2"},
]
const EMPTY_VARIABLES: string[] = []
const FALLBACK_POLICY_OPTIONS = ["off", "availability", "capacity", "access", "any"].map(
    (value) => ({label: value, value}),
)
const PROMPT_EXTENSION_KEYS = ["fallback_llm_configs", "retry_policy", "fallback_policy"]

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
    const resolvedTemplateFormat = useMemo((): "curly" | "fstring" | "jinja2" => {
        if (!value) return templateFormat
        const raw = value.template_format ?? value.templateFormat
        if (raw === "fstring") return "fstring"
        if (raw === "jinja2" || raw === "jinja") return "jinja2"
        if (raw === "curly") return "curly"
        return templateFormat
    }, [value, templateFormat])

    // Local template format state (initialized from value or prop)
    const [localTemplateFormat, setLocalTemplateFormat] = useState<"curly" | "fstring" | "jinja2">(
        resolvedTemplateFormat,
    )

    // Sync local state when value changes externally (e.g., discard/revert)
    useEffect(() => {
        setLocalTemplateFormat(resolvedTemplateFormat)
    }, [resolvedTemplateFormat])
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

    const promptExtensionSchemaProps = useMemo(() => {
        return ((schema?.properties as Record<string, SchemaProperty> | undefined) ?? {}) as Record<
            string,
            SchemaProperty
        >
    }, [schema])

    const hasPromptExtensionFields = useMemo(() => {
        return PROMPT_EXTENSION_KEYS.some(
            (key) => key in promptExtensionSchemaProps || Boolean(value && key in value),
        )
    }, [promptExtensionSchemaProps, value])

    const handlePromptRootFieldChange = useCallback(
        (key: string, nextValue: unknown) => {
            onChange({
                ...value,
                [key]: nextValue,
            })
        },
        [value, onChange],
    )

    const renderJsonRootField = useCallback(
        (key: "fallback_llm_configs" | "retry_policy", label: string, placeholder: string) => {
            const currentValue = value?.[key]
            const stringValue =
                currentValue === null || currentValue === undefined
                    ? ""
                    : JSON.stringify(currentValue, null, 2)

            return (
                <div key={key} className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">{label}</Typography.Text>
                    <Input.TextArea
                        key={`${key}-${JSON.stringify(currentValue ?? null)}`}
                        defaultValue={stringValue}
                        onBlur={(event) => {
                            const raw = event.target.value.trim()
                            if (!raw) {
                                handlePromptRootFieldChange(key, null)
                                return
                            }

                            try {
                                handlePromptRootFieldChange(key, JSON.parse(raw))
                            } catch {
                                // Keep the last valid value.
                            }
                        }}
                        disabled={disabled}
                        autoSize={{minRows: 3, maxRows: 8}}
                        placeholder={placeholder}
                    />
                </div>
            )
        },
        [disabled, handlePromptRootFieldChange, value],
    )

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
                            const format = val as "curly" | "fstring" | "jinja2"
                            setLocalTemplateFormat(format)
                            onTemplateFormatChange?.(format)
                            // Propagate to entity draft via onChange
                            onChange({
                                ...value,
                                [templateFormatKey]: format,
                            })
                        }}
                        options={TEMPLATE_FORMAT_OPTIONS}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                        style={{height: 24}}
                    />
                </div>
            )}

            {hasPromptExtensionFields && (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="font-medium">Fallback policy</Typography.Text>
                        <Select
                            size="small"
                            allowClear
                            value={
                                (value?.fallback_policy as string | null | undefined) ?? undefined
                            }
                            onChange={(nextValue) =>
                                handlePromptRootFieldChange("fallback_policy", nextValue ?? null)
                            }
                            disabled={disabled}
                            options={FALLBACK_POLICY_OPTIONS}
                            placeholder="Select one"
                        />
                    </div>
                    {renderJsonRootField(
                        "retry_policy",
                        "Retry policy",
                        '{"max_retries": 1, "delay_ms": 250}',
                    )}
                    {renderJsonRootField(
                        "fallback_llm_configs",
                        "Fallback LLM configs",
                        '[{"model": "gpt-4o-mini"}]',
                    )}
                </div>
            )}
        </div>
    )
})
