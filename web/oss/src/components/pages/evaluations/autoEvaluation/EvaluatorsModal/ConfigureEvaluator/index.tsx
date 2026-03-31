import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {CloseOutlined} from "@ant-design/icons"
import {ArrowLeft, Info, SidebarSimple} from "@phosphor-icons/react"
import {Button, Form, Input, Space, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {deriveEvaluatorOutputsSchema} from "@/oss/lib/evaluators/utils"
import {EvaluationSettingsTemplate, JSSTheme, SettingsPreset} from "@/oss/lib/Types"
import {
    CreateEvaluatorConfigData,
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
        import("@/agenta-oss-common/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/components/modals/LoadEvaluatorPreset"),
    {ssr: false},
)

const DebugSection: any = dynamic(
    () =>
        import("@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection"),
    {ssr: false},
)

/**
 * Props for ConfigureEvaluator
 *
 * Most state is now managed via atoms (see ./state/atoms.ts).
 * DebugSection fetches its own variants/testsets data internally.
 */
interface ConfigureEvaluatorProps {
    /** Callback when back button is clicked */
    onClose: () => void
    /** Callback after successful save */
    onSuccess: () => void
    /** Optional container class for height customization (e.g., drawer vs page) */
    containerClassName?: string
    /**
     * UI variant:
     * - page: existing standalone evaluator playground layout (default)
     * - drawer: inline evaluator creation drawer layout (Figma)
     */
    uiVariant?: "page" | "drawer"
    /** Drawer-only: whether the right test panel is visible */
    isTestPanelOpen?: boolean
    /** Drawer-only: toggle the right test panel */
    onToggleTestPanel?: () => void
}

interface ConfigureEvaluatorFormValues {
    name: string
    description?: string
    tags?: string[]
    parameters?: Record<string, any>
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
    containerClassName,
    uiVariant = "page",
    isTestPanelOpen = true,
    onToggleTestPanel,
}: ConfigureEvaluatorProps) => {
    const routeAppId = useAppId()
    const apps = useAppList()
    const appId = routeAppId ?? apps?.[0]?.app_id
    const router = useRouter()
    const {projectURL} = useURL()
    const classes = useStyles()

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
    const headerName = useMemo(() => {
        if (formName) return formName
        if (editMode) return editEvalEditValues?.name ?? ""
        return ""
    }, [editEvalEditValues?.name, editMode, formName])

    const isDrawerVariant = uiVariant === "drawer"
    const shouldShowTestPanel = isDrawerVariant ? Boolean(isTestPanelOpen) : true

    const settingsPresets = useMemo(
        () => selectedEvaluator?.settings_presets || [],
        [selectedEvaluator],
    )

    const parseVersion = useCallback((raw: unknown, fallback: number) => {
        if (raw === undefined || raw === null) return fallback
        const match = String(raw).match(/\d+(\.\d+)?/)
        return match ? parseFloat(match[0]) : fallback
    }, [])

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
            form.setFieldsValue({parameters: {}})

            if (allKeys.length) {
                const fieldNames = allKeys.map((key) => ["parameters", key] as (string | number)[])
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
            editEvalEditValues?.data?.parameters?.version ??
            selectedEvaluator?.settings_template?.version?.default ??
            3

        if (typeof raw === "number") return raw
        // extract leading number (e.g., "4", "4.1", "v4")
        const match = String(raw).match(/\d+(\.\d+)?/)
        return match ? parseFloat(match[0]) : 3
    }, [editEvalEditValues?.data?.parameters?.version, selectedEvaluator])

    const watchedCodeEvaluatorVersion = Form.useWatch(["parameters", "version"], form)

    const hasSavedCodeEvaluatorVersion = useMemo(() => {
        const saved = editEvalEditValues?.data?.parameters?.version
        return saved !== undefined && saved !== null && String(saved).trim() !== ""
    }, [editEvalEditValues?.data?.parameters?.version])

    const resolveCodeEvaluatorVersion = useCallback(
        (raw: unknown): number => {
            if (selectedEvaluator?.key !== "auto_custom_code_run") {
                return parseVersion(raw, 1)
            }

            if ((editMode || cloneConfig) && !hasSavedCodeEvaluatorVersion) {
                return 1
            }

            return parseVersion(raw, 1)
        },
        [selectedEvaluator?.key, parseVersion, editMode, cloneConfig, hasSavedCodeEvaluatorVersion],
    )

    const codeEvaluatorVersionNumber = useMemo(() => {
        if (selectedEvaluator?.key !== "auto_custom_code_run") return null

        return resolveCodeEvaluatorVersion(watchedCodeEvaluatorVersion)
    }, [selectedEvaluator?.key, watchedCodeEvaluatorVersion, resolveCodeEvaluatorVersion])

    const evalFields = useMemo(() => {
        const templateEntries = Object.entries(selectedEvaluator?.settings_template || {})
        const allowStructuredOutputs = evaluatorVersionNumber >= 4

        return templateEntries.reduce(
            (acc, [key, field]) => {
                const f = field as Partial<EvaluationSettingsTemplate> | undefined
                if (!f?.type) return acc
                if (
                    selectedEvaluator?.key === "auto_custom_code_run" &&
                    key === "correct_answer_key" &&
                    (codeEvaluatorVersionNumber ?? 1) >= 2
                ) {
                    return acc
                }
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
    }, [selectedEvaluator, evaluatorVersionNumber, codeEvaluatorVersionNumber])

    const advancedSettingsFields = evalFields.filter((field) => field.advanced)
    const basicSettingsFields = evalFields.filter((field) => !field.advanced)

    const onSubmit = async (values: ConfigureEvaluatorFormValues) => {
        try {
            setSubmitLoading(true)
            if (!selectedEvaluator?.key) throw new Error("No selected key")
            const parameters = {...(values.parameters || {})}

            const evaluatorVersion = resolveCodeEvaluatorVersion(parameters.version)

            if (selectedEvaluator.key === "auto_custom_code_run" && evaluatorVersion >= 2) {
                delete parameters.correct_answer_key
            }

            const jsonSchemaFieldPath: (string | number)[] = ["parameters", "json_schema"]
            const hasJsonSchema = Object.prototype.hasOwnProperty.call(parameters, "json_schema")

            if (hasJsonSchema) {
                form.setFields([{name: jsonSchemaFieldPath, errors: []}])

                if (typeof parameters.json_schema === "string") {
                    try {
                        const parsed = JSON.parse(parameters.json_schema)
                        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                            throw new Error()
                        }
                        parameters.json_schema = parsed
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
                    parameters.json_schema &&
                    (typeof parameters.json_schema !== "object" ||
                        Array.isArray(parameters.json_schema))
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

            const existingParameters = editEvalEditValues?.data?.parameters || {}
            const mergedParameters = {...existingParameters, ...parameters}

            if (selectedEvaluator.key === "auto_custom_code_run" && evaluatorVersion >= 2) {
                delete mergedParameters.correct_answer_key
            }

            const createOutputsSchema = deriveEvaluatorOutputsSchema({
                evaluatorKey: selectedEvaluator.key,
                evaluatorTemplate: selectedEvaluator,
                parameters,
            })
            const updateOutputsSchema = deriveEvaluatorOutputsSchema({
                evaluatorKey: selectedEvaluator.key,
                evaluatorTemplate: selectedEvaluator,
                parameters: mergedParameters,
            })

            const payload: CreateEvaluatorConfigData = {
                name: values.name,
                description: values.description,
                tags: values.tags,
                evaluator_key: selectedEvaluator.key,
                parameters,
                outputs_schema: createOutputsSchema,
            }

            if (editMode) {
                const existingData = editEvalEditValues?.data ?? {}
                const existingSchemas =
                    existingData.schemas &&
                    typeof existingData.schemas === "object" &&
                    !Array.isArray(existingData.schemas)
                        ? existingData.schemas
                        : undefined

                const nextSchemas = (() => {
                    if (updateOutputsSchema) {
                        return {
                            ...(existingSchemas ?? {}),
                            outputs: updateOutputsSchema,
                        }
                    }

                    if (!existingSchemas) return undefined

                    const {outputs, ...remainingSchemas} = existingSchemas
                    void outputs
                    return Object.keys(remainingSchemas).length ? remainingSchemas : undefined
                })()

                const {schemas: _unusedSchemas, ...dataWithoutSchemas} = existingData
                void _unusedSchemas

                const updatedEvaluator = await updateEvaluatorConfig(editEvalEditValues?.id!, {
                    id: editEvalEditValues?.id!,
                    name: values.name,
                    description: editEvalEditValues?.description,
                    tags: editEvalEditValues?.tags,
                    meta: editEvalEditValues?.meta,
                    flags: editEvalEditValues?.flags,
                    data: {
                        ...dataWithoutSchemas,
                        parameters: mergedParameters,
                        ...(nextSchemas ? {schemas: nextSchemas} : {}),
                    },
                })

                commitPlayground(updatedEvaluator)
            } else {
                const createdConfig = await createEvaluatorConfig(appId, payload)

                // Use commitPlayground to update state and switch to edit mode
                commitPlayground(createdConfig)
                if (uiVariant === "page" && createdConfig.id) {
                    await router.replace(
                        `${projectURL}/evaluators/configure/${encodeURIComponent(
                            createdConfig.id,
                        )}`,
                    )
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

    const initializeForm = useCallback(() => {
        // Reset form before loading new values so there are no stale values
        form.resetFields()

        if (editMode && editEvalEditValues) {
            // Load all values including nested parameters
            form.setFieldsValue({
                ...editEvalEditValues,
                parameters: editEvalEditValues.data?.parameters || {},
            })

            if (
                selectedEvaluator?.key === "auto_custom_code_run" &&
                !editEvalEditValues.data?.parameters?.version
            ) {
                form.setFieldValue(["parameters", "version"], "1")
            }
        } else if (cloneConfig && editEvalEditValues) {
            // When cloning, copy only parameters and clear the name so user provides a new name
            form.setFieldsValue({
                parameters: editEvalEditValues.data?.parameters || {},
                name: "",
            })

            if (
                selectedEvaluator?.key === "auto_custom_code_run" &&
                !editEvalEditValues.data?.parameters?.version
            ) {
                form.setFieldValue(["parameters", "version"], "1")
            }
        } else if (selectedEvaluator?.settings_template) {
            // Create mode: apply default values from the evaluator template
            // This is needed because form.resetFields() clears the form but Form.Item initialValue
            // only works on first mount, not after resetFields()
            const defaultSettings: Record<string, any> = {}
            for (const [key, field] of Object.entries(selectedEvaluator.settings_template)) {
                if (field && typeof field === "object" && "default" in field) {
                    defaultSettings[key] = field.default
                }
            }
            if (Object.keys(defaultSettings).length > 0) {
                form.setFieldsValue({
                    parameters: defaultSettings,
                })
            }
        }
    }, [editMode, cloneConfig, editEvalEditValues, form, selectedEvaluator])

    useEffect(() => {
        initializeForm()
    }, [initializeForm])

    // Guard: if no evaluator selected, show nothing (shouldn't happen in normal flow)
    if (!selectedEvaluator) {
        return null
    }

    const commitDisabled = isDrawerVariant
        ? !String(form.getFieldValue("name") ?? "").trim() || submitLoading
        : submitLoading

    return (
        <>
            <section className={containerClassName ?? "flex flex-col w-full h-[calc(100vh-84px)]"}>
                {isDrawerVariant ? (
                    <div className="h-[56px] flex items-center justify-between gap-3 px-4 border-0 border-b border-solid border-gray-200 sticky top-0 z-20 bg-white">
                        <div className="flex items-center gap-2 min-w-0">
                            <Button
                                icon={<CloseOutlined />}
                                className="flex items-center justify-center"
                                size="small"
                                type="text"
                                onClick={onClose}
                            />
                            <Typography.Text className="text-[14px] leading-[22px] font-[500] truncate">
                                {headerName || "New evaluator"}
                            </Typography.Text>
                        </div>

                        <Space size={8} align="center">
                            <Button
                                size="small"
                                onClick={onToggleTestPanel}
                                disabled={!onToggleTestPanel}
                                icon={<SidebarSimple size={14} />}
                            >
                                {shouldShowTestPanel ? "Hide test" : "Test evaluator"}
                            </Button>
                            <Button
                                size="small"
                                type="text"
                                onClick={initializeForm}
                                disabled={submitLoading}
                            >
                                Reset
                            </Button>
                            <Button
                                size="small"
                                type="primary"
                                loading={submitLoading}
                                disabled={commitDisabled}
                                onClick={form.submit}
                            >
                                Commit
                            </Button>
                        </Space>
                    </div>
                ) : (
                    // Existing page header
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
                )}

                {isDrawerVariant ? (
                    <div className="flex w-full flex-1 min-h-0 overflow-hidden">
                        {/* Left Column */}
                        <div
                            className={[
                                "flex-1 flex flex-col h-full min-w-0 overflow-hidden",
                                shouldShowTestPanel
                                    ? "border-r border-gray-200 border-0 border-solid"
                                    : "",
                            ].join(" ")}
                        >
                            {/* Configuration Header */}
                            <div className="h-[40px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-[#FAFAFB] flex-shrink-0">
                                <Space size={8} align="center">
                                    <span className="text-[12px] font-medium text-gray-800">
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
                            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
                                <Form
                                    requiredMark={false}
                                    form={form}
                                    name="new-evaluator"
                                    onFinish={onSubmit}
                                    layout="vertical"
                                    className="flex flex-col gap-4 w-full min-w-0"
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
                                            {/* TEMPORARY: Disabling name editing */}
                                            <Input disabled={editMode} />
                                        </Form.Item>
                                    </div>

                                    {basicSettingsFields.length ? (
                                        <div className="w-full max-w-full flex flex-col gap-2">
                                            <Typography.Text className="text-xs font-medium">
                                                Parameters
                                            </Typography.Text>

                                            {basicSettingsFields.map((field) => (
                                                <DynamicFormField
                                                    {...field}
                                                    key={field.key}
                                                    traceTree={traceTree}
                                                    form={form}
                                                    name={["parameters", field.key]}
                                                />
                                            ))}
                                        </div>
                                    ) : null}

                                    {advancedSettingsFields.length > 0 && (
                                        <AdvancedSettings
                                            settings={advancedSettingsFields}
                                            selectedTestcase={selectedTestcase}
                                        />
                                    )}
                                </Form>
                            </div>
                        </div>

                        {/* Right Column */}
                        {shouldShowTestPanel && (
                            <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden">
                                {/* Test Evaluator Header */}
                                <div className="h-[40px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-[#FAFAFB] flex-shrink-0">
                                    <span className="font-medium text-[12px]">Test evaluator</span>
                                </div>

                                {/* Debug Section Content */}
                                <div className="flex-1 overflow-y-auto p-4">
                                    <DebugSection />
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    // Existing page layout (keep unchanged to avoid regressions)
                    <div className="flex w-full h-full overflow-hidden">
                        {/* Left Column */}
                        <div className="flex-1 flex flex-col h-full min-w-0 border-r border-gray-200 border-0 border-solid overflow-y-auto">
                            {/* Evaluator Name & Actions */}
                            <div className="h-[48px] px-4 flex items-center justify-between border-0 border-b border-solid border-gray-200 bg-white flex-shrink-0 sticky top-0 z-10">
                                <Typography.Text className="font-semibold text-[14px]">
                                    {headerName || "New evaluator"}
                                </Typography.Text>
                                <Space>
                                    <Button type="text" onClick={initializeForm}>
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
                                    className={`${classes.formContainer} min-w-0`}
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
                                            {/* TEMPORARY: Disabling name editing */}
                                            <Input disabled={editMode} />
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
                                                    name={["parameters", field.key]}
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
                                <DebugSection />
                            </div>
                        </div>
                    </div>
                )}
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
