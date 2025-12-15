import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Flex, Form, Input, Space, Typography, Divider, Collapse} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import {useAppId} from "@/oss/hooks/useAppId"
import {
    EvaluationSettingsTemplate,
    Evaluator,
    EvaluatorConfig,
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

interface ConfigureEvaluatorProps {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    onSuccess: () => void
    selectedEvaluator: Evaluator
    variants: Variant[] | null
    testsets: testset[] | null
    selectedTestcase: {
        testcase: Record<string, any> | null
    }
    setSelectedVariant: React.Dispatch<React.SetStateAction<Variant | null>>
    selectedVariant: Variant | null
    editMode: boolean
    editEvalEditValues: EvaluatorConfig | null
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<EvaluatorConfig | null>>
    setEditMode: (value: React.SetStateAction<boolean>) => void
    cloneConfig: boolean
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setSelectedTestcase: React.Dispatch<
        React.SetStateAction<{
            testcase: Record<string, any> | null
        }>
    >
    setSelectedTestset: React.Dispatch<React.SetStateAction<string>>
    selectedTestset: string
    appId?: string | null
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
    setCurrent,
    selectedEvaluator,
    handleOnCancel,
    variants,
    testsets,
    onSuccess,
    selectedTestcase,
    selectedVariant,
    setSelectedVariant,
    editMode,
    editEvalEditValues,
    setEditEvalEditValues,
    setEditMode,
    cloneConfig,
    setCloneConfig,
    setSelectedTestcase,
    selectedTestset,
    setSelectedTestset,
    appId: appIdOverride,
}: ConfigureEvaluatorProps) => {
    const routeAppId = useAppId()
    const apps = useAppList()
    const appId = appIdOverride ?? routeAppId ?? apps?.[0].app_id
    const classes = useStyles()

    const [isLoadEvaluatorPresetsModalOpen, setIsLoadEvaluatorPresetsModalOpen] = useState(false)
    const [selectedSettingsPreset, setSelectedSettingsPreset] = useState<SettingsPreset | null>(
        null,
    )

    const [form] = Form.useForm()
    const [submitLoading, setSubmitLoading] = useState(false)
    const [traceTree, setTraceTree] = useState<{
        trace: Record<string, any> | string | null
    }>({
        trace: null,
    })

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
            if (!selectedEvaluator.key) throw new Error("No selected key")
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
                evaluator_key: selectedEvaluator.key,
                settings_values: settingsValues,
            }

            if (editMode) {
                await updateEvaluatorConfig(editEvalEditValues?.id!, data)

                setEditEvalEditValues((previous) =>
                    previous
                        ? {
                              ...previous,
                              ...data,
                              settings_values: settingsValues,
                          }
                        : previous,
                )
            } else {
                const response = await createEvaluatorConfig(appId, data)
                const createdConfig = response?.data

                if (createdConfig) {
                    setEditEvalEditValues(createdConfig)
                    setEditMode(true)
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

    return (
        <>
            <section className="flex flex-col w-full h-[calc(100vh-84px)]">
                <div className="flex items-center justify-between border-0 border-b border-solid border-gray-200 py-2 px-4 sticky top-0 z-20 bg-white">
                    <div className="flex items-center gap-2">
                        <Button
                            icon={<ArrowLeft size={14} />}
                            className="flex items-center justify-center"
                            size="small"
                            onClick={() => {
                                setCurrent(0)
                                setEditMode(false)
                                setCloneConfig(false)
                                setEditEvalEditValues(null)
                            }}
                        />
                        <Typography.Text className={classes.title}>
                            {editMode ? "Edit evaluator" : "Configure evaluator"}
                        </Typography.Text>
                    </div>

                    <Flex gap={8} justify="end">
                        <Button type="text" onClick={() => form.resetFields()}>
                            Reset
                        </Button>
                        <Button type="primary" loading={submitLoading} onClick={form.submit}>
                            Commit
                        </Button>
                    </Flex>
                </div>

                <div className="flex w-full h-full pr-4 overflow-auto">
                    <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0 h-full w-[50%]">
                        <Collapse
                            ghost
                            className={clsx("rounded-none", classes.collapseContainer)}
                            bordered={false}
                            defaultActiveKey={["1"]}
                            activeKey={["1"]}
                            items={[
                                {
                                    key: "1",
                                    label: "Configuration",
                                    showArrow: false,
                                    collapsible: "disabled",
                                    children: (
                                        <>
                                            <Space direction="vertical">
                                                <Flex justify="space-between">
                                                    <Typography.Text className={classes.title}>
                                                        {selectedEvaluator.name}
                                                    </Typography.Text>
                                                </Flex>
                                                <Typography.Text type="secondary">
                                                    {selectedEvaluator.description}
                                                </Typography.Text>
                                            </Space>

                                            <div>
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
                                                                    message:
                                                                        "This field is required",
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
                                                                    name={[
                                                                        "settings_values",
                                                                        field.key,
                                                                    ]}
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
                                        </>
                                    ),
                                    extra: settingsPresets.length > 0 && (
                                        <Button
                                            size="small"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                setIsLoadEvaluatorPresetsModalOpen(true)
                                            }}
                                        >
                                            Load Preset
                                        </Button>
                                    ),
                                },
                            ]}
                        />
                    </div>

                    <Divider type="vertical" className="h-full sticky m-0 mr-6" />

                    <DebugSection
                        selectedEvaluator={selectedEvaluator}
                        selectedTestcase={selectedTestcase}
                        selectedVariant={selectedVariant}
                        setTraceTree={setTraceTree}
                        debugEvaluator={true}
                        form={form}
                        testsets={testsets}
                        traceTree={traceTree}
                        variants={variants}
                        setSelectedVariant={setSelectedVariant}
                        setSelectedTestcase={setSelectedTestcase}
                        selectedTestset={selectedTestset}
                        setSelectedTestset={setSelectedTestset}
                    />
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
