import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {DeleteOutlined, InfoCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {
    Button,
    Checkbox,
    Flex,
    FormInstance,
    Input,
    InputNumber,
    Select,
    Space,
    Typography,
    Alert,
    Tooltip,
    Modal,
} from "antd"
import {createUseStyles} from "react-jss"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {JSSTheme} from "@/oss/lib/Types"

import {
    generateJSONSchema,
    isSchemaCompatibleWithBasicMode,
    parseJSONSchema,
} from "./JSONSchemaGenerator"
import {CategoricalOption, ResponseFormatType, SchemaConfig} from "./types"

interface JSONSchemaEditorProps {
    form: FormInstance
    name: string | string[]
    defaultValue?: string
}

const createDefaultCategories = (): CategoricalOption[] => [
    {name: "good", description: "The response is good"},
    {name: "bad", description: "The response is bad"},
]

const useStyles = createUseStyles((theme: JSSTheme) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        "& .monaco-editor": {
            width: "0 !important",
        },
    },
    categoryItem: {
        display: "flex",
        gap: theme.marginXS,
        alignItems: "flex-start",
        marginBottom: theme.marginXS,
    },
}))

export const JSONSchemaEditor: React.FC<JSONSchemaEditorProps> = ({form, name, defaultValue}) => {
    const [modal, contextHolder] = Modal.useModal()
    const classes = useStyles()
    const [mode, setMode] = useState("basic")

    // Basic mode state
    const [responseFormat, setResponseFormat] = useState<ResponseFormatType>("boolean")
    const [includeReasoning, setIncludeReasoning] = useState(false)
    const [minValue, setMinValue] = useState(0)
    const [maxValue, setMaxValue] = useState(10)
    const [categories, setCategories] = useState<CategoricalOption[]>(createDefaultCategories())

    // Advanced mode state
    const [rawSchema, setRawSchema] = useState(defaultValue ?? "")
    const [supportsBasicMode, setSupportsBasicMode] = useState<boolean>(() => {
        if (!defaultValue) {
            return true
        }

        return isSchemaCompatibleWithBasicMode(defaultValue)
    })

    const lastSyncedValueRef = useRef<string | undefined>(undefined)

    const namePath = useMemo(() => (Array.isArray(name) ? name : [name]), [name])

    const applyParsedConfig = useCallback((parsed: SchemaConfig) => {
        setResponseFormat(parsed.responseFormat)
        setIncludeReasoning(parsed.includeReasoning)

        if (parsed.continuousConfig) {
            setMinValue(parsed.continuousConfig.minimum)
            setMaxValue(parsed.continuousConfig.maximum)
        }

        if (parsed.categoricalOptions && parsed.categoricalOptions.length > 0) {
            setCategories(parsed.categoricalOptions)
        } else {
            setCategories(createDefaultCategories())
        }
    }, [])

    const syncFormValue = useCallback(
        (value: string) => {
            const current = form.getFieldValue(namePath)
            if (current === value && lastSyncedValueRef.current === value) return

            form.setFieldValue(namePath, value)
            lastSyncedValueRef.current = value
        },
        [form, namePath],
    )

    const getDefaultConfig = useCallback((): SchemaConfig => {
        return {
            responseFormat: "boolean",
            includeReasoning: false,
            continuousConfig: {minimum: 0, maximum: 10},
            categoricalOptions: createDefaultCategories(),
        }
    }, [])

    const applyConfigAndSync = useCallback(
        (config: SchemaConfig) => {
            applyParsedConfig(config)
            const schemaString = JSON.stringify(generateJSONSchema(config), null, 2)
            setRawSchema(schemaString)
            syncFormValue(schemaString)
            setSupportsBasicMode(true)
        },
        [applyParsedConfig, syncFormValue],
    )

    // Initialize from default value
    useEffect(() => {
        if (!defaultValue) {
            setSupportsBasicMode(true)
            setRawSchema("")
            return
        }

        if (lastSyncedValueRef.current === defaultValue) {
            return
        }

        const parsed = parseJSONSchema(defaultValue)
        if (parsed) applyParsedConfig(parsed)

        setSupportsBasicMode(isSchemaCompatibleWithBasicMode(defaultValue))
        setRawSchema(defaultValue)
    }, [defaultValue, applyParsedConfig])

    useEffect(() => {
        if (!supportsBasicMode && mode !== "advanced") {
            setMode("advanced")
        }
    }, [supportsBasicMode, mode])

    // Update form when basic mode changes
    useEffect(() => {
        if (mode === "basic" && supportsBasicMode) {
            const config: SchemaConfig = {
                responseFormat,
                includeReasoning,
                continuousConfig: {minimum: minValue, maximum: maxValue},
                categoricalOptions: categories,
            }
            const schema = generateJSONSchema(config)
            const schemaString = JSON.stringify(schema, null, 2)

            syncFormValue(schemaString)
        }
    }, [
        mode,
        responseFormat,
        includeReasoning,
        minValue,
        maxValue,
        categories,
        supportsBasicMode,
        syncFormValue,
    ])

    const handleModeSwitch = (newMode: "basic" | "advanced") => {
        if (newMode === mode) {
            return
        }

        if (newMode === "advanced" && mode === "basic") {
            const config: SchemaConfig = {
                responseFormat,
                includeReasoning,
                continuousConfig: {minimum: minValue, maximum: maxValue},
                categoricalOptions: categories,
            }
            const schema = generateJSONSchema(config)
            const schemaString = JSON.stringify(schema, null, 2)
            setRawSchema(schemaString)
            syncFormValue(schemaString)
            setSupportsBasicMode(true)
            setMode("advanced")
            return
        }

        if (newMode === "basic" && mode === "advanced") {
            if (!supportsBasicMode) {
                modal.confirm({
                    title: "Switch to basic mode?",
                    content:
                        "Switching to basic mode will reset your advanced configuration. Are you sure?",
                    okText: "Switch",
                    cancelText: "Cancel",
                    onOk: () => {
                        const parsed = parseJSONSchema(rawSchema)
                        const config = parsed ?? getDefaultConfig()
                        applyConfigAndSync(config)
                        setMode("basic")
                    },
                })
                return
            }

            const parsed = parseJSONSchema(rawSchema)
            const config = parsed ?? getDefaultConfig()
            applyConfigAndSync(config)
            setMode("basic")
            return
        }

        setMode(newMode)
    }

    const addCategory = () => {
        setCategories([...categories, {name: "", description: ""}])
    }

    const removeCategory = (index: number) => {
        setCategories(categories.filter((_, i) => i !== index))
    }

    const updateCategory = (index: number, field: "name" | "description", value: string) => {
        const updated = [...categories]
        updated[index][field] = value
        setCategories(updated)
    }

    if (mode === "advanced") {
        return (
            <>
                <div>
                    <Flex justify="space-between" align="center" style={{marginBottom: 16}}>
                        <Typography.Text strong>Configuration (Advanced Mode)</Typography.Text>
                        <Tooltip title="Switch back to basic mode for a simplified form-based interface.">
                            <Button size="small" onClick={() => handleModeSwitch("basic")}>
                                Basic Mode
                            </Button>
                        </Tooltip>
                    </Flex>

                    <SharedEditor
                        className={classes.editor}
                        editorType="border"
                        placeholder="Enter JSON schema..."
                        initialValue={rawSchema}
                        handleChange={(value) => {
                            if (value !== undefined) {
                                setRawSchema(value)
                                setSupportsBasicMode(
                                    value ? isSchemaCompatibleWithBasicMode(value) : false,
                                )

                                if (Array.isArray(name)) {
                                    form.setFieldValue(name, value)
                                } else {
                                    form.setFieldValue([name], value)
                                }
                            }
                        }}
                        editorProps={{
                            codeOnly: true,
                            language: "json",
                        }}
                        syncWithInitialValueChanges={true}
                    />
                </div>
                {contextHolder}
            </>
        )
    }

    // Basic Mode
    return (
        <>
            <div>
                <Flex justify="space-between" align="center" style={{marginBottom: 16}}>
                    <Typography.Text strong>Feedback Configuration</Typography.Text>
                    <Tooltip title="Switch to advanced mode to edit the raw JSON schema directly for full control over the response format.">
                        <Button size="small" onClick={() => handleModeSwitch("advanced")}>
                            Advanced Mode
                        </Button>
                    </Tooltip>
                </Flex>

                <Space direction="vertical" style={{width: "100%"}} size="middle">
                    {/* Response Format */}
                    <div>
                        <div
                            style={{display: "flex", alignItems: "center", gap: 4, marginBottom: 8}}
                        >
                            <Typography.Text strong>Response Format</Typography.Text>
                            <Tooltip title="Choose the format for your evaluation results. Select Boolean for yes/no answers, Continuous for numeric scores, or Categorical for predefined options.">
                                <InfoCircleOutlined style={{fontSize: 12, color: "#999"}} />
                            </Tooltip>
                        </div>
                        <Select
                            style={{width: "100%"}}
                            value={responseFormat}
                            onChange={(value) => setResponseFormat(value)}
                            options={[
                                {label: "Boolean (True/False)", value: "boolean"},
                                {label: "Continuous (Numeric Range)", value: "continuous"},
                                {label: "Categorical (Predefined Options)", value: "categorical"},
                            ]}
                        />
                    </div>

                    {/* Conditional fields based on response format */}
                    {responseFormat === "boolean" && (
                        <Alert
                            message="The evaluator will provide a true (1) or false (0) response based on the feedback criteria."
                            type="info"
                            showIcon
                        />
                    )}

                    {responseFormat === "continuous" && (
                        <div>
                            <div style={{marginBottom: 12}}>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        marginBottom: 8,
                                    }}
                                >
                                    <Typography.Text strong>Minimum</Typography.Text>
                                    <Tooltip title="The minimum value for the numeric score range.">
                                        <InfoCircleOutlined style={{fontSize: 12, color: "#999"}} />
                                    </Tooltip>
                                </div>
                                <InputNumber
                                    style={{width: "100%"}}
                                    value={minValue}
                                    onChange={(value) => setMinValue(value ?? 0)}
                                />
                            </div>
                            <div>
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        marginBottom: 8,
                                    }}
                                >
                                    <Typography.Text strong>Maximum</Typography.Text>
                                    <Tooltip title="The maximum value for the numeric score range.">
                                        <InfoCircleOutlined style={{fontSize: 12, color: "#999"}} />
                                    </Tooltip>
                                </div>
                                <InputNumber
                                    style={{width: "100%"}}
                                    value={maxValue}
                                    onChange={(value) => setMaxValue(value ?? 10)}
                                />
                            </div>
                        </div>
                    )}

                    {responseFormat === "categorical" && (
                        <div>
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    marginBottom: 8,
                                }}
                            >
                                <Typography.Text strong>Categories</Typography.Text>
                                <Tooltip title="Define the predefined categories that the evaluator can choose from. Each category needs a name and description.">
                                    <InfoCircleOutlined style={{fontSize: 12, color: "#999"}} />
                                </Tooltip>
                            </div>
                            {categories.map((category, index) => (
                                <div key={index} className={classes.categoryItem}>
                                    <Input
                                        placeholder="Category name"
                                        value={category.name}
                                        onChange={(e) =>
                                            updateCategory(index, "name", e.target.value)
                                        }
                                        style={{width: 150}}
                                    />
                                    <Input
                                        placeholder="Description"
                                        value={category.description}
                                        onChange={(e) =>
                                            updateCategory(index, "description", e.target.value)
                                        }
                                        style={{flex: 1}}
                                    />
                                    <Button
                                        type="text"
                                        danger
                                        icon={<DeleteOutlined />}
                                        onClick={() => removeCategory(index)}
                                        disabled={categories.length <= 1}
                                    />
                                </div>
                            ))}
                            <Button
                                type="dashed"
                                icon={<PlusOutlined />}
                                onClick={addCategory}
                                style={{width: "100%"}}
                            >
                                Add Category
                            </Button>
                        </div>
                    )}

                    {/* Include Reasoning */}
                    <div style={{display: "flex", alignItems: "center", gap: 4}}>
                        <Checkbox
                            checked={includeReasoning}
                            onChange={(e) => setIncludeReasoning(e.target.checked)}
                        >
                            <Typography.Text strong>Include reasoning</Typography.Text>
                        </Checkbox>
                        <Tooltip title="When enabled, the evaluator will also provide a text explanation justifying the result.">
                            <InfoCircleOutlined style={{fontSize: 12, color: "#999"}} />
                        </Tooltip>
                    </div>
                </Space>
            </div>
            {contextHolder}
        </>
    )
}
