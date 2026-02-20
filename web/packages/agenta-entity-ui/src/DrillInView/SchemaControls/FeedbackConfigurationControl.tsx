/**
 * FeedbackConfigurationControl
 *
 * A high-level control for configuring evaluator feedback format.
 * Provides a simplified UI for selecting response format (Boolean, Continuous, Categorical)
 * and generates the appropriate JSON schema.
 *
 * This mirrors the Feedback Configuration UI from the debug section.
 */

import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {LabeledField} from "@agenta/ui/components/presentational"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {DeleteOutlined, InfoCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Alert, Button, Checkbox, Input, InputNumber, Modal, Select, Tooltip, Typography} from "antd"

// ============================================================================
// TYPES
// ============================================================================

export type ResponseFormatType = "continuous" | "boolean" | "categorical"

export interface CategoricalOption {
    name: string
    description: string
}

export interface FeedbackConfig {
    responseFormat: ResponseFormatType
    includeReasoning: boolean
    minimum?: number
    maximum?: number
    categories?: CategoricalOption[]
}

export interface GeneratedJSONSchema {
    name: string
    schema: {
        title: string
        description: string
        type: "object"
        properties: Record<string, unknown>
        required: string[]
        additionalProperties: boolean
    }
    strict: boolean
}

export interface FeedbackConfigurationControlProps {
    /** Current JSON schema value */
    value: unknown
    /** Called when the schema changes */
    onChange: (schema: unknown) => void
    /** Whether the control is disabled */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /**
     * Original server schema value for preserving custom descriptions.
     * When provided, custom descriptions from this schema will be preserved
     * when regenerating the schema from UI changes.
     */
    originalValue?: unknown
}

// ============================================================================
// SCHEMA GENERATION
// ============================================================================

function generateJSONSchema(
    config: FeedbackConfig,
    originalSchema?: GeneratedJSONSchema | null,
): GeneratedJSONSchema {
    const {responseFormat, includeReasoning, minimum, maximum, categories} = config

    // Preserve original descriptions if available
    const origProps = originalSchema?.schema?.properties as
        | Record<string, Record<string, unknown>>
        | undefined
    const origScoreDesc = origProps?.score?.description as string | undefined
    const origReasoningDesc = (origProps?.reasoning?.description ??
        origProps?.comment?.description) as string | undefined
    const origSchemaDesc = originalSchema?.schema?.description as string | undefined
    const origSchemaTitle = originalSchema?.schema?.title as string | undefined

    const properties: Record<string, unknown> = {}
    const required: string[] = ["score"]
    const baseDescription = origScoreDesc ?? "The grade results"

    switch (responseFormat) {
        case "continuous":
            properties.score = {
                type: "number",
                description: baseDescription,
                minimum: minimum ?? 0,
                maximum: maximum ?? 10,
            }
            break

        case "boolean":
            properties.score = {
                type: "boolean",
                description: baseDescription,
            }
            break

        case "categorical":
            if (categories && categories.length > 0) {
                const enumValues = categories.map((opt) => opt.name)
                const categoryDescriptions = categories
                    .map((opt) => `"${opt.name}": ${opt.description}`)
                    .join("| ")

                properties.score = {
                    type: "string",
                    description: `${baseDescription}. Categories: ${categoryDescriptions}`,
                    enum: enumValues,
                }
            } else {
                properties.score = {
                    type: "string",
                    description: baseDescription,
                }
            }
            break
    }

    if (includeReasoning) {
        properties.reasoning = {
            type: "string",
            description: origReasoningDesc ?? "Reasoning for the score",
        }
        required.push("reasoning")
    }

    return {
        name: "schema",
        schema: {
            title: origSchemaTitle ?? "extract",
            description: origSchemaDesc ?? "Extract information from the user's response.",
            type: "object",
            properties,
            required,
            additionalProperties: false,
        },
        strict: true,
    }
}

function parseJSONSchema(schemaValue: unknown): FeedbackConfig | null {
    try {
        const parsed = typeof schemaValue === "string" ? JSON.parse(schemaValue) : schemaValue
        if (!parsed) return null

        const schema = parsed.schema || parsed
        const properties = schema?.properties
        if (!properties?.score) return null

        const scoreProperty = properties.score as Record<string, unknown>
        const scoreType = scoreProperty.type as string

        let responseFormat: ResponseFormatType = "boolean"
        let minimum: number | undefined
        let maximum: number | undefined
        let categories: CategoricalOption[] | undefined

        if (scoreType === "boolean") {
            responseFormat = "boolean"
        } else if (scoreType === "number") {
            responseFormat = "continuous"
            minimum = (scoreProperty.minimum as number) ?? 0
            maximum = (scoreProperty.maximum as number) ?? 10
        } else if (scoreType === "string" && Array.isArray(scoreProperty.enum)) {
            responseFormat = "categorical"
            const enumValues = scoreProperty.enum as string[]
            categories = enumValues.map((name) => ({name, description: ""}))
        }

        // Check for reasoning field (can be named "comment" or "reasoning")
        const includeReasoning = !!properties.comment || !!properties.reasoning

        return {responseFormat, includeReasoning, minimum, maximum, categories}
    } catch {
        return null
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export const FeedbackConfigurationControl = memo(function FeedbackConfigurationControl({
    value,
    onChange,
    disabled = false,
    className,
    originalValue,
}: FeedbackConfigurationControlProps) {
    // Parse value prop to config
    const parsedConfig = useMemo(() => parseJSONSchema(value), [value])

    // Local state
    const [responseFormat, setResponseFormat] = useState<ResponseFormatType>(
        parsedConfig?.responseFormat ?? "boolean",
    )
    const [includeReasoning, setIncludeReasoning] = useState(
        parsedConfig?.includeReasoning ?? false,
    )
    const [minimum, setMinimum] = useState(parsedConfig?.minimum ?? 0)
    const [maximum, setMaximum] = useState(parsedConfig?.maximum ?? 10)
    const [categories, setCategories] = useState<CategoricalOption[]>(
        parsedConfig?.categories ?? [
            {name: "good", description: "The response is good"},
            {name: "bad", description: "The response is bad"},
        ],
    )

    // Mode state: basic (form UI) or advanced (raw JSON editor)
    const [mode, setMode] = useState<"basic" | "advanced">("basic")
    const [rawSchema, setRawSchema] = useState<string>(() => {
        if (!value) return ""
        return typeof value === "string" ? value : JSON.stringify(value, null, 2)
    })
    const [modal, contextHolder] = Modal.useModal()

    // Track the previous value to detect external changes (e.g., discard)
    const prevValueRef = useRef(value)

    // Capture the initial value on first render for preserving descriptions
    // This ref is never updated after mount, ensuring we always have the original descriptions
    const initialValueRef = useRef<GeneratedJSONSchema | null>(
        (() => {
            const source = originalValue ?? value
            if (!source) return null
            try {
                return typeof source === "string"
                    ? JSON.parse(source)
                    : (source as GeneratedJSONSchema)
            } catch {
                return null
            }
        })(),
    )

    // Use originalValue prop if provided, otherwise use the captured initial value
    const originalSchema = useMemo((): GeneratedJSONSchema | null => {
        if (originalValue) {
            try {
                return typeof originalValue === "string"
                    ? JSON.parse(originalValue)
                    : (originalValue as GeneratedJSONSchema)
            } catch {
                return null
            }
        }
        // Fall back to initial value captured on mount
        return initialValueRef.current
    }, [originalValue])

    // Sync local state when value prop changes externally (e.g., after discard)
    useEffect(() => {
        // Skip if value hasn't changed
        if (prevValueRef.current === value) return
        prevValueRef.current = value

        // Update raw schema for advanced mode
        if (value) {
            setRawSchema(typeof value === "string" ? value : JSON.stringify(value, null, 2))
        } else {
            setRawSchema("")
        }

        // NOTE: We intentionally do NOT update initialSchemaRef here.
        // The initial schema should be preserved from mount to maintain original descriptions.
        // Only update it if this is a "reset" scenario (discard), which we detect by checking
        // if the new value matches the server schema structure more closely than the current draft.

        // Re-parse and sync local state
        const newConfig = parseJSONSchema(value)
        if (newConfig) {
            setResponseFormat(newConfig.responseFormat)
            setIncludeReasoning(newConfig.includeReasoning)
            setMinimum(newConfig.minimum ?? 0)
            setMaximum(newConfig.maximum ?? 10)
            setCategories(
                newConfig.categories ?? [
                    {name: "good", description: "The response is good"},
                    {name: "bad", description: "The response is bad"},
                ],
            )
        }
    }, [value])

    // Helper to emit schema change - called directly by handlers, NOT via useEffect
    const emitSchemaChange = useCallback(
        (config: FeedbackConfig) => {
            const schema = generateJSONSchema(config, originalSchema)
            onChange(schema)
        },
        [onChange, originalSchema],
    )

    // Handlers that update local state AND emit changes immediately
    const handleResponseFormatChange = useCallback(
        (newFormat: ResponseFormatType) => {
            setResponseFormat(newFormat)
            emitSchemaChange({
                responseFormat: newFormat,
                includeReasoning,
                minimum: newFormat === "continuous" ? minimum : undefined,
                maximum: newFormat === "continuous" ? maximum : undefined,
                categories: newFormat === "categorical" ? categories : undefined,
            })
        },
        [emitSchemaChange, includeReasoning, minimum, maximum, categories],
    )

    const handleIncludeReasoningChange = useCallback(
        (newValue: boolean) => {
            setIncludeReasoning(newValue)
            emitSchemaChange({
                responseFormat,
                includeReasoning: newValue,
                minimum: responseFormat === "continuous" ? minimum : undefined,
                maximum: responseFormat === "continuous" ? maximum : undefined,
                categories: responseFormat === "categorical" ? categories : undefined,
            })
        },
        [emitSchemaChange, responseFormat, minimum, maximum, categories],
    )

    const handleMinimumChange = useCallback(
        (newValue: number | null) => {
            const val = newValue ?? 0
            setMinimum(val)
            emitSchemaChange({
                responseFormat,
                includeReasoning,
                minimum: val,
                maximum,
                categories: responseFormat === "categorical" ? categories : undefined,
            })
        },
        [emitSchemaChange, responseFormat, includeReasoning, maximum, categories],
    )

    const handleMaximumChange = useCallback(
        (newValue: number | null) => {
            const val = newValue ?? 10
            setMaximum(val)
            emitSchemaChange({
                responseFormat,
                includeReasoning,
                minimum,
                maximum: val,
                categories: responseFormat === "categorical" ? categories : undefined,
            })
        },
        [emitSchemaChange, responseFormat, includeReasoning, minimum, categories],
    )

    // Category handlers
    const addCategory = useCallback(() => {
        const newCategories = [...categories, {name: "", description: ""}]
        setCategories(newCategories)
        emitSchemaChange({
            responseFormat,
            includeReasoning,
            minimum: responseFormat === "continuous" ? minimum : undefined,
            maximum: responseFormat === "continuous" ? maximum : undefined,
            categories: newCategories,
        })
    }, [emitSchemaChange, responseFormat, includeReasoning, minimum, maximum, categories])

    const removeCategory = useCallback(
        (index: number) => {
            const newCategories = categories.filter((_, i) => i !== index)
            setCategories(newCategories)
            emitSchemaChange({
                responseFormat,
                includeReasoning,
                minimum: responseFormat === "continuous" ? minimum : undefined,
                maximum: responseFormat === "continuous" ? maximum : undefined,
                categories: newCategories,
            })
        },
        [emitSchemaChange, responseFormat, includeReasoning, minimum, maximum, categories],
    )

    const updateCategory = useCallback(
        (index: number, field: "name" | "description", value: string) => {
            const newCategories = categories.map((cat, i) =>
                i === index ? {...cat, [field]: value} : cat,
            )
            setCategories(newCategories)
            emitSchemaChange({
                responseFormat,
                includeReasoning,
                minimum: responseFormat === "continuous" ? minimum : undefined,
                maximum: responseFormat === "continuous" ? maximum : undefined,
                categories: newCategories,
            })
        },
        [emitSchemaChange, responseFormat, includeReasoning, minimum, maximum, categories],
    )

    // Check if current schema is compatible with basic mode
    const isSchemaCompatibleWithBasicMode = useCallback((schemaValue: unknown): boolean => {
        const config = parseJSONSchema(schemaValue)
        if (!config) return false
        // Regenerate and compare
        const regenerated = generateJSONSchema(config)
        const original = typeof schemaValue === "string" ? JSON.parse(schemaValue) : schemaValue
        const originalSchema = original?.schema || original
        const regeneratedSchema = regenerated.schema
        // Simple comparison - if structures match, it's compatible
        return JSON.stringify(originalSchema) === JSON.stringify(regeneratedSchema)
    }, [])

    // Handle mode switch
    const handleModeSwitch = useCallback(
        (newMode: "basic" | "advanced") => {
            if (newMode === mode) return

            if (newMode === "advanced") {
                // Switching to advanced: sync raw schema from current config
                const schema = generateJSONSchema(
                    {
                        responseFormat,
                        includeReasoning,
                        minimum: responseFormat === "continuous" ? minimum : undefined,
                        maximum: responseFormat === "continuous" ? maximum : undefined,
                        categories: responseFormat === "categorical" ? categories : undefined,
                    },
                    originalSchema,
                )
                setRawSchema(JSON.stringify(schema, null, 2))
                setMode("advanced")
                return
            }

            // Switching to basic
            if (!isSchemaCompatibleWithBasicMode(rawSchema)) {
                modal.confirm({
                    title: "Switch to basic mode?",
                    content:
                        "Switching to basic mode will reset your advanced configuration. Are you sure?",
                    okText: "Switch",
                    cancelText: "Cancel",
                    onOk: () => {
                        const parsed = parseJSONSchema(rawSchema)
                        if (parsed) {
                            setResponseFormat(parsed.responseFormat)
                            setIncludeReasoning(parsed.includeReasoning)
                            setMinimum(parsed.minimum ?? 0)
                            setMaximum(parsed.maximum ?? 10)
                            setCategories(
                                parsed.categories ?? [
                                    {name: "good", description: "The response is good"},
                                    {name: "bad", description: "The response is bad"},
                                ],
                            )
                        }
                        setMode("basic")
                    },
                })
                return
            }

            // Compatible - just switch
            const parsed = parseJSONSchema(rawSchema)
            if (parsed) {
                setResponseFormat(parsed.responseFormat)
                setIncludeReasoning(parsed.includeReasoning)
                setMinimum(parsed.minimum ?? 0)
                setMaximum(parsed.maximum ?? 10)
                setCategories(
                    parsed.categories ?? [
                        {name: "good", description: "The response is good"},
                        {name: "bad", description: "The response is bad"},
                    ],
                )
            }
            setMode("basic")
        },
        [
            mode,
            responseFormat,
            includeReasoning,
            minimum,
            maximum,
            categories,
            rawSchema,
            isSchemaCompatibleWithBasicMode,
            modal,
            originalSchema,
        ],
    )

    // Handle raw schema change in advanced mode
    const handleRawSchemaChange = useCallback(
        (newValue: string) => {
            setRawSchema(newValue)
            try {
                const parsed = JSON.parse(newValue)
                onChange(parsed)
            } catch {
                // Invalid JSON - don't emit
            }
        },
        [onChange],
    )

    // Advanced mode UI
    if (mode === "advanced") {
        return (
            <div className={className}>
                <div className="flex justify-between items-center mb-4">
                    <Typography.Text strong>Configuration (Advanced Mode)</Typography.Text>
                    <Tooltip title="Switch back to basic mode for a simplified form-based interface">
                        <Button
                            size="small"
                            onClick={() => handleModeSwitch("basic")}
                            disabled={disabled}
                        >
                            Basic Mode
                        </Button>
                    </Tooltip>
                </div>
                <div className="border border-solid border-gray-200 rounded overflow-hidden">
                    <SharedEditor
                        editorType="border"
                        placeholder="Enter JSON schema..."
                        initialValue={rawSchema}
                        value={rawSchema}
                        handleChange={handleRawSchemaChange}
                        disabled={disabled}
                        editorProps={{
                            codeOnly: true,
                            language: "json",
                        }}
                        syncWithInitialValueChanges={true}
                    />
                </div>
                {contextHolder}
            </div>
        )
    }

    // Basic mode UI
    return (
        <div className={className}>
            {/* Response Format */}
            <div className="mb-4">
                <LabeledField
                    label="Response Format"
                    description="Choose the format for your evaluation results"
                >
                    <Select
                        style={{width: "100%"}}
                        value={responseFormat}
                        onChange={handleResponseFormatChange}
                        disabled={disabled}
                        options={[
                            {label: "Boolean (True/False)", value: "boolean"},
                            {label: "Continuous (Numeric Range)", value: "continuous"},
                            {label: "Categorical (Predefined Options)", value: "categorical"},
                        ]}
                    />
                </LabeledField>
            </div>

            {/* Boolean info */}
            {responseFormat === "boolean" && (
                <Alert
                    message="The evaluator will provide a true (1) or false (0) response based on the feedback criteria."
                    type="info"
                    showIcon
                    className="mb-4"
                />
            )}

            {/* Continuous fields */}
            {responseFormat === "continuous" && (
                <div className="mb-4 flex flex-col gap-3">
                    <LabeledField
                        label="Minimum"
                        description="The minimum value for the numeric score range"
                    >
                        <InputNumber
                            style={{width: "100%"}}
                            value={minimum}
                            onChange={handleMinimumChange}
                            disabled={disabled}
                        />
                    </LabeledField>
                    <LabeledField
                        label="Maximum"
                        description="The maximum value for the numeric score range"
                    >
                        <InputNumber
                            style={{width: "100%"}}
                            value={maximum}
                            onChange={handleMaximumChange}
                            disabled={disabled}
                        />
                    </LabeledField>
                </div>
            )}

            {/* Categorical fields */}
            {responseFormat === "categorical" && (
                <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1">
                            <Typography.Text strong className="text-sm">
                                Categories
                            </Typography.Text>
                            <Tooltip title="Define the possible category values for the evaluation">
                                <InfoCircleOutlined className="text-xs text-gray-400" />
                            </Tooltip>
                        </div>
                        <Button
                            size="small"
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={addCategory}
                            disabled={disabled}
                        >
                            Add
                        </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                        {categories.map((cat, index) => (
                            <div key={index} className="flex gap-2 items-start">
                                <Input
                                    placeholder="Name"
                                    value={cat.name}
                                    onChange={(e) => updateCategory(index, "name", e.target.value)}
                                    disabled={disabled}
                                    className="flex-1"
                                />
                                <Input
                                    placeholder="Description"
                                    value={cat.description}
                                    onChange={(e) =>
                                        updateCategory(index, "description", e.target.value)
                                    }
                                    disabled={disabled}
                                    className="flex-[2]"
                                />
                                <Button
                                    type="text"
                                    danger
                                    icon={<DeleteOutlined />}
                                    onClick={() => removeCategory(index)}
                                    disabled={disabled || categories.length <= 1}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Include reasoning */}
            <div className="flex items-center gap-2 mb-4">
                <Checkbox
                    checked={includeReasoning}
                    onChange={(e) => handleIncludeReasoningChange(e.target.checked)}
                    disabled={disabled}
                >
                    Include reasoning
                </Checkbox>
                <Tooltip title="When enabled, the evaluator will also provide a comment explaining the score">
                    <InfoCircleOutlined className="text-xs text-gray-400" />
                </Tooltip>
            </div>

            {/* Advanced mode toggle */}
            <div className="flex justify-end">
                <Tooltip title="Switch to advanced mode to edit the raw JSON schema directly">
                    <Button
                        size="small"
                        onClick={() => handleModeSwitch("advanced")}
                        disabled={disabled}
                    >
                        Advanced Mode
                    </Button>
                </Tooltip>
            </div>
            {contextHolder}
        </div>
    )
})

export default FeedbackConfigurationControl
