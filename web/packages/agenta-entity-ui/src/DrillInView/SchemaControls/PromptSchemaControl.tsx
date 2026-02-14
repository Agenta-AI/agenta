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

import {memo, useCallback, useMemo, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {SimpleChatMessage} from "@agenta/shared/types"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {cn} from "@agenta/ui/styles"
import {Plus} from "@phosphor-icons/react"
import {Button, Select} from "antd"
import {v4 as uuidv4} from "uuid"

import {useDrillInUI} from "../context"

import {ResponseFormatControl, type ResponseFormatValue} from "./ResponseFormatControl"
import {
    denormalizeMessages,
    getLLMConfigValue,
    getResponseFormatSchema,
    hasNestedLLMConfig,
    normalizeMessages,
} from "./schemaUtils"
import {ToolItemControl} from "./ToolItemControl"
import {ToolSelectorPopover} from "./ToolSelectorPopover"
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
    variables = [],
    entityId,
    hideModelSelector: _hideModelSelector = false,
    renderProviderIcon,
}: PromptSchemaControlProps) {
    // Get injected EditorProvider from context
    const {EditorProvider} = useDrillInUI()

    // Local template format state (initialized from props, can be changed by user)
    const [localTemplateFormat, setLocalTemplateFormat] = useState<"curly" | "fstring" | "jinja2">(
        templateFormat,
    )

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
    // No agenta_metadata is injected — ToolItemControl infers builtin status
    // via inferBuiltinToolInfo which matches against TOOL_SPECS payloads.
    const handleAddTool = useCallback(
        (newTool: ToolObj) => {
            const currentTools = getToolsArray()
            setToolsValue([...currentTools, newTool])
        },
        [getToolsArray, setToolsValue],
    )

    // Extract tools array from value (respects nested llm_config)
    const tools = useMemo(() => getToolsArray(), [getToolsArray])

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
                tokens={variables}
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
                                renderProviderIcon={renderProviderIcon}
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

                    {/* Add Tool */}
                    <ToolSelectorPopover
                        onAddTool={handleAddTool}
                        disabled={disabled}
                        renderProviderIcon={renderProviderIcon}
                        existingToolCount={tools.length}
                    />

                    {/* Output type (response format) with JSON schema editing */}
                    <ResponseFormatControl
                        controlId={entityId || "response-format"}
                        schema={responseFormatSchema}
                        value={responseFormatValue}
                        onChange={handleResponseFormatChange}
                        disabled={disabled}
                        size="small"
                    />

                    {/* Template format */}
                    <Select
                        size="small"
                        value={localTemplateFormat}
                        onChange={(val) => {
                            const format = val as "curly" | "fstring" | "jinja2"
                            setLocalTemplateFormat(format)
                            onTemplateFormatChange?.(format)
                        }}
                        options={TEMPLATE_FORMAT_OPTIONS}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                        style={{height: 24}}
                    />
                </div>
            )}
        </div>
    )
})
