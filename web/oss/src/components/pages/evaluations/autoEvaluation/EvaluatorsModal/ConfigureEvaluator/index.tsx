import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowLeft, Info} from "@phosphor-icons/react"
import {Button, Form, Input, Space, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import {useAppId} from "@/oss/hooks/useAppId"
import {
    EvaluationSettingsTemplate,
    JSSTheme,
    SettingsPreset,
    testset,
    Variant,
} from "@/oss/lib/Types"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    updateEvaluatorConfig,
} from "@/oss/services/evaluations/api"
import {useAppList} from "@/oss/state/app"

import AdvancedSettings from "./AdvancedSettings"
import {DynamicFormField} from "./DynamicFormField"
import {
    commitPlaygroundAtom,
    playgroundEditValuesAtom,
    playgroundEvaluatorAtom,
    playgroundFormRefAtom,
    playgroundIsCloneModeAtom,
    playgroundIsEditModeAtom,
    playgroundSelectedTestcaseAtom,
    playgroundTraceTreeAtom,
} from "./state/atoms"

const LoadEvaluatorPreset = dynamic(
    () =>
        import(
            "@/agenta-oss-common/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/components/modals/LoadEvaluatorPreset"
        ),
    {ssr: false},
)

const DebugSection: any = dynamic(
    () =>
        import(
            "@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection"
        ),
    {ssr: false},
)

/**
 * Props for ConfigureEvaluator
 *
 * Most state is now managed via atoms (see ./state/atoms.ts).
 * These props are for:
 * - Callbacks that need to be provided by parent
 * - Data that comes from queries (variants, testsets)
 * - Layout customization
 */
interface ConfigureEvaluatorProps {
    /** Callback when back button is clicked */
    onClose: () => void
    /** Callback after successful save */
    onSuccess: () => void
    /** Available variants for testing (from query) */
    variants: Variant[] | null
    /** Available testsets for testing (from query) */
    testsets: testset[] | null
    /** Optional app ID override (defaults to route app or first app) */
    appId?: string | null
    /** Optional container class for height customization (e.g., drawer vs page) */
    containerClassName?: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    collapseContainer: {
        "& .ant-collapse-header": {
            backgroundColor: `#FAFAFB !important`,
            borderBottom: `1px solid ${theme.colorSplit} !important`,
            cursor: "default !important",
        },
        "& .ant-collapse-item": {
            display: "flex !important",
            flexDirection: "column",
        },
        "& .ant-collapse-content": {
            borderBottom: `0.1px solid ${theme.colorSplit} !important`,
            borderRadius: "0px !important",
        },
        "& .ant-collapse-header-text": {
            lineHeight: theme.lineHeight,
            color: theme.colorText,
        },
    },
    headerText: {
        "& .ant-typography": {
            lineHeight: theme.lineHeightLG,
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
        },
    },
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
    },
    formContainer: {
        display: "flex",
        flexDirection: "column",
        gap: theme.padding,
        height: "100%",
        width: "100%",
        "& .ant-form-item": {
            marginBottom: 10,
        },
    },
    formTitleText: {
        fontSize: theme.fontSize,
        lineHeight: theme.lineHeight,
        fontWeight: theme.fontWeightMedium,
    },
}))

const ConfigureEvaluator = ({
    onClose,
    onSuccess,
    variants,
    testsets,
    appId: appIdOverride,
    containerClassName,
}: ConfigureEvaluatorProps) => {
    const routeAppId = useAppId()
    const apps = useAppList()
    const appId = appIdOverride ?? routeAppId ?? apps?.[0].app_id
    const classes = useStyles()

    // DEBUG: Log variants prop received
    console.log("[ConfigureEvaluator] variants prop:", {
        variants: variants,
        variantsLength: variants?.length,
        variantsIds: variants?.map((v: any) => v.variantId),
        testsets: testsets?.length,
        appId,
    })

    // ================================================================
    // ATOMS - Read state from playground atoms
    // ================================================================
    const selectedEvaluator = useAtomValue(playgroundEvaluatorAtom)
    const editMode = useAtomValue(playgroundIsEditModeAtom)
    const cloneConfig = useAtomValue(playgroundIsCloneModeAtom)
    const editEvalEditValues = useAtomValue(playgroundEditValuesAtom)
    // These are read-only here; DebugSection manages updates via atoms
    const selectedTestcase = useAtomValue(playgroundSelectedTestcaseAtom)
    const traceTree = useAtomValue(playgroundTraceTreeAtom)
    const setFormRef = useSetAtom(playgroundFormRefAtom)
    const commitPlayground = useSetAtom(commitPlaygroundAtom)

    // ================================================================
    // LOCAL STATE - UI-only state that doesn't need to be shared
    // ================================================================
    const [isLoadEvaluatorPresetsModalOpen, setIsLoadEvaluatorPresetsModalOpen] = useState(false)
    const [selectedSettingsPreset, setSelectedSettingsPreset] = useState<SettingsPreset | null>(
        null,
    )
    const [form] = Form.useForm()
    const [submitLoading, setSubmitLoading] = useState(false)

    // Store form ref in atom so DebugSection can access it
    useEffect(() => {
        setFormRef(form)
        return () => setFormRef(null)
    }, [form, setFormRef])

    // Watch form name field for display in header
    const formName = Form.useWatch("name", form)

    const settingsPresets = useMemo(
        () => selectedEvaluator?.settings_presets || [],
        [selectedEvaluator],
    )

    const normalizePresetMessages = useCallback((value: unknown) => {
        if (typeof value === "string") {
            if (!value.trim()) return []
            return [{role: "system", content: value}]
        }
        if (!Array.isArray(value)) return []
        return value.filter(Boolean).map((entry: any) => ({
            role: entry?.role ?? "user",
            content: entry?.content ?? "",
        }))
    }, [])

    // Apply preset values into the form, resetting only affected subfields
    const applySettingsValues = useCallback(
        (settingsValues: Record<string, any> | null | undefined) => {
            const template = selectedEvaluator?.settings_template ?? {}
            const presetKeys = settingsValues ? Object.keys(settingsValues) : []
            const templateKeys = Object.keys(template)
            const allKeys = Array.from(new Set([...templateKeys, ...presetKeys]))

            // Clear subtree before applying new values to avoid stale keys
            form.setFieldsValue({settings_values: {}})

            if (allKeys.length) {
                const fieldNames = allKeys.map(
                    (key) => ["settings_values", key] as (string | number)[],
                )
                form.resetFields(fieldNames)

                const nextFields = fieldNames
                    .map((namePath) => {
                        const key = namePath[1] as string
                        const field = (template as any)?.[key]
                        const rawValue = (settingsValues as any)?.[key]

                        if (rawValue === undefined) return null

                        // Keep json_schema as a real object in the form.
                        const isJsonSchema = key === "json_schema"
                        const value =
                            field?.type === "object" &&
                            rawValue &&
                            typeof rawValue === "object" &&
                            !Array.isArray(rawValue) &&
                            !isJsonSchema
                                ? JSON.stringify(rawValue, null, 2)
                                : rawValue

                        return {name: namePath, value}
                    })
                    .filter(Boolean) as {name: (string | number)[]; value: any}[]

                if (nextFields.length) {
                    form.setFields(nextFields)
                }
            }

            // Optional: sync a "messages" field if the template uses prompt_template
            if (Object.prototype.hasOwnProperty.call(settingsValues ?? {}, "prompt_template")) {
                form.setFieldValue(
                    ["messages"],
                    normalizePresetMessages((settingsValues as any)?.prompt_template),
                )
            }
        },
        [form, normalizePresetMessages, selectedEvaluator?.settings_template],
    )

    const evaluatorVersionNumber = useMemo(() => {
        const raw =
            editEvalEditValues?.settings_values?.version ??
            selectedEvaluator?.settings_template?.version?.default ??
            3

        if (typeof raw === "number") return raw
        // extract leading number (e.g., "4", "4.1", "v4")
        const match = String(raw).match(/\d+(\.\d+)?/)
        return match ? parseFloat(match[0]) : 3
    }, [editEvalEditValues?.settings_values?.version, selectedEvaluator])

    const evalFields = useMemo(() => {
        const templateEntries = Object.entries(selectedEvaluator?.settings_template || {})
        const allowStructuredOutputs = evaluatorVersionNumber >= 4

        return templateEntries.reduce(
            (acc, [key, field]) => {
                const f = field as Partial<EvaluationSettingsTemplate> | undefined
                if (!f?.type) return acc
                if (!allowStructuredOutputs && (key === "json_schema" || key === "response_type")) {
                    return acc
                }
                acc.push({
                    key,
                    ...(f as EvaluationSettingsTemplate),
                    advanced: Boolean((f as any)?.advanced),
                })
                return acc
            },
            [] as (EvaluationSettingsTemplate & {key: string})[],
        )
    }, [selectedEvaluator, evaluatorVersionNumber])

    const advancedSettingsFields = evalFields.filter((field) => field.advanced)
    const basicSettingsFields = evalFields.filter((field) => !field.advanced)

    const onSubmit = async (values: CreateEvaluationConfigData) => {
        try {
            setSubmitLoading(true)
            if (!selectedEvaluator?.key) throw new Error("No selected key")
            const settingsValues = values.settings_values || {}

            const jsonSchemaFieldPath: (string | number)[] = ["settings_values", "json_schema"]
            const hasJsonSchema = Object.prototype.hasOwnProperty.call(
                settingsValues,
                "json_schema",
            )

            if (hasJsonSchema) {
                form.setFields([{name: jsonSchemaFieldPath, errors: []}])

                if (typeof settingsValues.json_schema === "string") {
                    try {
                        const parsed = JSON.parse(settingsValues.json_schema)
                        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                            throw new Error()
                        }
                        settingsValues.json_schema = parsed
                    } catch {
                        form.setFields([
                            {
                                name: jsonSchemaFieldPath,
                                errors: ["Enter a valid JSON object"],
                            },
                        ])
                        throw new Error("JSON schema must be a valid JSON object")
                    }
                } else if (
                    settingsValues.json_schema &&
                    (typeof settingsValues.json_schema !== "object" ||
                        Array.isArray(settingsValues.json_schema))
                ) {
                    form.setFields([
                        {
                            name: jsonSchemaFieldPath,
                            errors: ["Enter a valid JSON object"],
                        },
                    ])
                    throw new Error("JSON schema must be a valid JSON object")
                }
            }

            const data = {
                ...values,
                evaluator_key: selectedEvaluator!.key,
                settings_values: settingsValues,
            }

            if (editMode) {
                await updateEvaluatorConfig(editEvalEditValues?.id!, data)

                // Update atom with merged values
                const updatedConfig = editEvalEditValues
                    ? {
                          ...editEvalEditValues,
                          ...data,
                          settings_values: settingsValues,
                      }
                    : null
                if (updatedConfig) {
                    commitPlayground(updatedConfig)
                }
            } else {
                const response = await createEvaluatorConfig(appId, data)
                const createdConfig = response?.data

                if (createdConfig) {
                    // Use commitPlayground to update state and switch to edit mode
                    commitPlayground(createdConfig)
                }
            }

            onSuccess()
        } catch (error: any) {
            if (error?.errorFields) return
            console.error(error)
            message.error(error.message)
        } finally {
            setSubmitLoading(false)
        }
    }

    useEffect(() => {
        // Reset form before loading new values so there are no stale values
        form.resetFields()

        if (editMode && editEvalEditValues) {
            // Load all values including nested settings_values
            form.setFieldsValue({
                ...editEvalEditValues,
                settings_values: editEvalEditValues.settings_values || {},
            })
        } else if (cloneConfig && editEvalEditValues) {
            // When cloning, copy only settings_values and clear the name so user provides a new name
            form.setFieldsValue({
                settings_values: editEvalEditValues.settings_values || {},
                name: "",
            })
        }
    }, [editMode, cloneConfig, editEvalEditValues, form])

    // Guard: if no evaluator selected, show nothing (shouldn't happen in normal flow)
    if (!selectedEvaluator) {
        return null
    }

    return (
        <>
            <section className={containerClassName ?? "flex flex-col w-full h-[calc(100vh-84px)]"}>
                {/* Top Header - grey like playground */}
                <div className="flex items-center justify-between gap-4 px-2.5 py-2 border-0 border-b border-solid border-gray-200 sticky top-0 z-20 bg-[#FAFAFB]">
                    <div className="flex items-center gap-2">
                        <Button
                            icon={<ArrowLeft size={14} />}
                            className="flex items-center justify-center"
                            size="small"
                            onClick={onClose}
                        />
                        <Typography.Text className="text-[16px] leading-[18px] font-[600]">
                            {editMode ? "Edit evaluator" : "Configure evaluator"}
                        </Typography.Text>
                    </div>
                </div>

                <div className="flex w-full h-full overflow-hidden">
                    {/* Left Column */}
                    <div className="flex-1 flex flex-col h-full min-w-0 border-r border-gray-200 border-0 border-solid overflow-y-auto">
                        {/* Evaluator Name & Actions */}
                        <div className="h-[48px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-white flex-shrink-0 sticky top-0 z-10">
                            <Typography.Text className="font-semibold text-[14px]">
                                {formName || "New evaluator"}
                            </Typography.Text>
                            <Space>
                                <Button type="text" onClick={() => form.resetFields()}>
                                    Reset
                                </Button>
                                <Button
                                    type="primary"
                                    loading={submitLoading}
                                    onClick={form.submit}
                                >
                                    Commit
                                </Button>
                            </Space>
                        </div>

                        {/* Configuration Header */}
                        <div className="h-[48px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-[#FAFAFB] flex-shrink-0 sticky top-[48px] z-10">
                            <Space size={8} align="center">
                                <span className="text-[14px] font-medium text-gray-800">
                                    Configuration
                                </span>
                                <Tag color={selectedEvaluator.color || "default"}>
                                    {selectedEvaluator.name}
                                </Tag>
                                <Tooltip title={selectedEvaluator.description}>
                                    <span className="flex items-center">
                                        <Info size={16} className="text-gray-500 cursor-help" />
                                    </span>
                                </Tooltip>
                            </Space>
                            {settingsPresets.length > 0 && (
                                <Button
                                    size="small"
                                    onClick={() => setIsLoadEvaluatorPresetsModalOpen(true)}
                                >
                                    Load Preset
                                </Button>
                            )}
                        </div>

                        {/* Scrollable Form Area */}
                        <div className="p-4">
                            <Form
                                requiredMark={false}
                                form={form}
                                name="new-evaluator"
                                onFinish={onSubmit}
                                layout="vertical"
                                className={classes.formContainer}
                            >
                                <div className="flex gap-4">
                                    <Form.Item
                                        name="name"
                                        label="Name"
                                        rules={[
                                            {
                                                required: true,
                                                message: "This field is required",
                                            },
                                        ]}
                                        className="w-full"
                                    >
                                        <Input />
                                    </Form.Item>
                                </div>

                                {basicSettingsFields.length ? (
                                    <div className="h-full w-full max-w-full flex flex-col gap-2">
                                        <Typography.Text className="text-xs font-medium">
                                            Parameters
                                        </Typography.Text>

                                        {basicSettingsFields.map((field) => (
                                            <DynamicFormField
                                                {...field}
                                                key={field.key}
                                                traceTree={traceTree}
                                                form={form}
                                                name={["settings_values", field.key]}
                                            />
                                        ))}
                                    </div>
                                ) : null}

                                {advancedSettingsFields.length > 0 && (
                                    <div className="h-fit">
                                        <AdvancedSettings
                                            settings={advancedSettingsFields}
                                            selectedTestcase={selectedTestcase}
                                        />
                                    </div>
                                )}
                            </Form>
                        </div>
                    </div>

                    {/* Right Column */}
                    <div className="flex-1 flex flex-col h-full min-w-0 overflow-y-auto">
                        {/* Test Evaluator Header */}
                        <div className="h-[48px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-white flex-shrink-0 sticky top-0 z-10">
                            <span className="font-semibold text-[14px]">Test evaluator</span>
                        </div>

                        {/* Debug Section Content - without its own title */}
                        <div className="p-4">
                            <DebugSection
                                testsets={testsets}
                                variants={variants}
                                debugEvaluator={true}
                            />
                        </div>
                    </div>
                </div>
            </section>

            <LoadEvaluatorPreset
                open={isLoadEvaluatorPresetsModalOpen}
                onCancel={() => setIsLoadEvaluatorPresetsModalOpen(false)}
                settingsPresets={settingsPresets}
                selectedSettingsPreset={selectedSettingsPreset}
                setSelectedSettingsPreset={setSelectedSettingsPreset}
                applySettingsValues={applySettingsValues}
            />
        </>
    )
}

export default ConfigureEvaluator
