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
import type {SimpleChatMessage} from "@agenta/shared"
import {ChatMessageList, cn} from "@agenta/ui"
import {CaretDown, Plus, Wrench} from "@phosphor-icons/react"
import {Button, Popover, Select, Typography} from "antd"
import {v4 as uuidv4} from "uuid"

import {useDrillInUI} from "../context"
import {formatLabel} from "../utils"

import {GroupedChoiceControl} from "./GroupedChoiceControl"
import {NumberSliderControl} from "./NumberSliderControl"
import {ResponseFormatControl, type ResponseFormatValue} from "./ResponseFormatControl"
import {
    denormalizeMessages,
    getLLMConfigProperties,
    getLLMConfigValue,
    getModelSchema,
    getOptionsFromSchema,
    getResponseFormatSchema,
    hasGroupedChoices,
    hasNestedLLMConfig,
    normalizeMessages,
} from "./schemaUtils"

/**
 * Known LLM config parameters with their metadata for value-based fallback rendering.
 * Used when schema doesn't have property definitions but value contains these keys.
 */
const KNOWN_LLM_PARAMS: Record<
    string,
    {label: string; min: number; max: number; step: number; description: string}
> = {
    temperature: {
        label: "Temperature",
        min: 0,
        max: 2,
        step: 0.1,
        description: "Controls randomness. Higher values make output more random.",
    },
    max_tokens: {
        label: "Max Tokens",
        min: 1,
        max: 128000,
        step: 1,
        description: "Maximum number of tokens to generate.",
    },
    top_p: {
        label: "Top P",
        min: 0,
        max: 1,
        step: 0.1,
        description: "Nucleus sampling. Consider tokens with top_p probability mass.",
    },
    frequency_penalty: {
        label: "Frequency Penalty",
        min: -2,
        max: 2,
        step: 0.1,
        description: "Penalizes tokens based on their frequency in the text so far.",
    },
    presence_penalty: {
        label: "Presence Penalty",
        min: -2,
        max: 2,
        step: 0.1,
        description: "Penalizes tokens based on whether they appear in the text so far.",
    },
}

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
    /** Available template variables for token highlighting */
    variables?: string[]
    /** Entity ID for response format modal state tracking */
    entityId?: string
    /** Hide the model selector (when it's shown elsewhere, e.g., in collapse header) */
    hideModelSelector?: boolean
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
    {label: "Curly {{var}}", value: "curly"},
    {label: "F-string {var}", value: "fstring"},
    {label: "Jinja2 {{ var }}", value: "jinja2"},
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
    label,
    value,
    onChange,
    description,
    disabled = false,
    className,
    templateFormat = "curly",
    variables = [],
    entityId,
    hideModelSelector = false,
}: PromptSchemaControlProps) {
    // Get injected SelectLLMProvider from context
    const {SelectLLMProvider} = useDrillInUI()

    // Model config popover state
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)

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

    // Get LLM config value (handles nested vs root level)
    const llmConfigValue = useMemo(() => getLLMConfigValue(value), [value])

    // Extract model value from llm_config
    const model = llmConfigValue?.model as string | undefined

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

    // Extract LLM config values
    const llmConfigProps = useMemo(() => getLLMConfigProperties(schema), [schema])
    const modelSchema = useMemo(() => getModelSchema(schema), [schema])
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

    // Handle model change (respects nested llm_config structure)
    const handleModelChange = useCallback(
        (newModel: string | null) => {
            if (isNestedLLMConfig) {
                const llmConfigKey = value?.llm_config ? "llm_config" : "llmConfig"
                const currentLLMConfig = (value?.[llmConfigKey] || {}) as Record<string, unknown>
                onChange({
                    ...value,
                    [llmConfigKey]: {
                        ...currentLLMConfig,
                        model: newModel,
                    },
                })
            } else {
                onChange({
                    ...value,
                    model: newModel,
                })
            }
        },
        [value, onChange, isNestedLLMConfig],
    )

    // Handle LLM config property change (respects nested llm_config structure)
    const handleConfigChange = useCallback(
        (key: string, newValue: unknown) => {
            if (isNestedLLMConfig) {
                const llmConfigKey = value?.llm_config ? "llm_config" : "llmConfig"
                const currentLLMConfig = (value?.[llmConfigKey] || {}) as Record<string, unknown>
                onChange({
                    ...value,
                    [llmConfigKey]: {
                        ...currentLLMConfig,
                        [key]: newValue,
                    },
                })
            } else {
                onChange({
                    ...value,
                    [key]: newValue,
                })
            }
        },
        [value, onChange, isNestedLLMConfig],
    )

    // Handle response format change (respects nested llm_config structure)
    // Accepts full ResponseFormatValue object with type and optional json_schema
    const handleResponseFormatChange = useCallback(
        (newFormat: ResponseFormatValue) => {
            if (isNestedLLMConfig) {
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
        [value, onChange, isNestedLLMConfig],
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

    // Handle add tool (placeholder - adds empty tool config)
    const handleAddTool = useCallback(() => {
        const tools = (value?.tools as unknown[]) || []
        const newTool = {
            type: "function",
            function: {
                name: `tool_${tools.length + 1}`,
                description: "",
                parameters: {type: "object", properties: {}},
            },
        }
        onChange({
            ...value,
            tools: [...tools, newTool],
        })
    }, [value, onChange])

    // Display model name
    const displayModel = model ?? "Choose a model"

    // Check if model schema has grouped choices (for GroupedChoiceControl fallback)
    const hasSchemaChoices = useMemo(() => hasGroupedChoices(modelSchema), [modelSchema])

    // Extract model options from schema for SelectLLMProvider
    const modelOptions = useMemo(() => {
        const result = getOptionsFromSchema(modelSchema)
        return result?.options ?? []
    }, [modelSchema])

    // Get value-based LLM config params (used when schema doesn't have property definitions)
    // Always show all known params so users can set them, using current value or default
    const valueLLMConfigParams = useMemo(() => {
        // If schema already has properties, don't use value-based fallback
        if (Object.keys(llmConfigProps).length > 0) return []

        // Show all known params - use current value if exists, otherwise use a reasonable default
        const params: {
            key: string
            value: number | null
            metadata: (typeof KNOWN_LLM_PARAMS)[string]
        }[] = []
        for (const [key, metadata] of Object.entries(KNOWN_LLM_PARAMS)) {
            const val = llmConfigValue?.[key]
            // Include the param with current value if number, or null to show as unset
            params.push({
                key,
                value: typeof val === "number" ? val : null,
                metadata,
            })
        }
        return params
    }, [llmConfigProps, llmConfigValue])

    // Model config popover content (includes model selector + LLM config properties)
    const modelConfigContent = (
        <div className="flex flex-col gap-3 min-w-[300px]">
            <div className="flex items-center justify-between border-b border-zinc-2 pb-2">
                <Typography.Text className="text-sm text-zinc-9">Model Parameters</Typography.Text>
            </div>

            {/* Model selector - use SelectLLMProvider directly from context */}
            <div className="flex flex-col gap-1">
                <Typography.Text className="text-xs text-zinc-9">Model</Typography.Text>
                {SelectLLMProvider ? (
                    <SelectLLMProvider
                        showGroup
                        showAddProvider
                        showCustomSecretsOnOptions
                        options={modelOptions}
                        value={model ?? undefined}
                        onChange={(val: string | undefined) => handleModelChange(val ?? null)}
                        disabled={disabled}
                        placeholder="Select a model"
                        size="small"
                    />
                ) : hasSchemaChoices ? (
                    <GroupedChoiceControl
                        schema={modelSchema}
                        label=""
                        value={model ?? null}
                        onChange={handleModelChange}
                        disabled={disabled}
                        withTooltip={false}
                    />
                ) : (
                    /* Fallback to read-only text when no dropdown available */
                    <Typography.Text className="text-zinc-6">{model || "Not set"}</Typography.Text>
                )}
            </div>

            {/* LLM config properties from schema */}
            {Object.entries(llmConfigProps).map(([key, propSchema]) => {
                const propValue = llmConfigValue?.[key]
                return (
                    <NumberSliderControl
                        key={key}
                        schema={propSchema}
                        label={formatLabel(key)}
                        value={propValue as number | null}
                        onChange={(v) => handleConfigChange(key, v)}
                        disabled={disabled}
                        withTooltip
                    />
                )
            })}

            {/* Value-based fallback for LLM config params (when schema is missing) */}
            {valueLLMConfigParams.map(({key, value, metadata}) => (
                <NumberSliderControl
                    key={key}
                    label={metadata.label}
                    value={value}
                    onChange={(v) => handleConfigChange(key, v ?? metadata.min)}
                    disabled={disabled}
                    withTooltip
                    description={metadata.description}
                    min={metadata.min}
                    max={metadata.max}
                    step={metadata.step}
                />
            ))}

            {/* No model settings available message */}
            {!model &&
                Object.keys(llmConfigProps).length === 0 &&
                valueLLMConfigParams.length === 0 && (
                    <Typography.Text type="secondary" className="text-xs">
                        No model settings available
                    </Typography.Text>
                )}
        </div>
    )

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            {/* Header with label and model config button */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    {label && (
                        <>
                            <Typography.Text className="font-medium">{label}</Typography.Text>
                            {description && (
                                <Typography.Text type="secondary" className="text-xs">
                                    {description}
                                </Typography.Text>
                            )}
                        </>
                    )}
                </div>

                {/* Model config button with popover - show if schema has model/llmConfig OR if value has model/llmParams */}
                {!hideModelSelector &&
                    (modelSchema ||
                        Object.keys(llmConfigProps).length > 0 ||
                        model ||
                        valueLLMConfigParams.length > 0) && (
                        <Popover
                            open={!disabled && isModelConfigOpen}
                            onOpenChange={disabled ? undefined : setIsModelConfigOpen}
                            trigger={["click"]}
                            placement="bottomRight"
                            arrow={false}
                            content={modelConfigContent}
                        >
                            <Button disabled={disabled} className="flex items-center gap-1">
                                {displayModel}
                                <CaretDown size={14} />
                            </Button>
                        </Popover>
                    )}
            </div>

            {/* Messages list */}
            <ChatMessageList
                messages={messages}
                onChange={handleMessagesChange}
                disabled={disabled}
                showControls={false}
                allowFileUpload={!disabled}
                placeholder="Enter message content..."
                className="[&_.chat-message-editor]:border [&_.chat-message-editor]:border-zinc-2 [&_.chat-message-editor]:rounded-lg"
                enableTokens={true}
                templateFormat={localTemplateFormat}
                tokens={variables}
            />

            {/* Action bar - Message, Tool, Output type, Template format */}
            {!disabled && (
                <div className="flex items-center flex-wrap gap-2">
                    {/* Add Message */}
                    <Button size="small" icon={<Plus size={14} />} onClick={handleAddMessage}>
                        Message
                    </Button>

                    {/* Add Tool */}
                    <Button size="small" icon={<Wrench size={14} />} onClick={handleAddTool}>
                        Tool
                    </Button>

                    {/* Output type (response format) with JSON schema editing */}
                    {responseFormatSchema && (
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
                        onChange={(val) =>
                            setLocalTemplateFormat(val as "curly" | "fstring" | "jinja2")
                        }
                        options={TEMPLATE_FORMAT_OPTIONS}
                        className="min-w-[130px]"
                        popupMatchSelectWidth={false}
                    />
                </div>
            )}
        </div>
    )
})
