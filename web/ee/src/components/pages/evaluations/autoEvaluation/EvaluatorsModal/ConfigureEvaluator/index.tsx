import {useEffect, useMemo, useState} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Flex, Form, Input, message, Space, Typography, Splitter, Divider} from "antd"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {useAppId} from "@/oss/hooks/useAppId"
import {Evaluator, EvaluatorConfig, JSSTheme, testset, Variant} from "@/oss/lib/Types"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    updateEvaluatorConfig,
} from "@/oss/services/evaluations/api"
import {useAppList} from "@/oss/state/app"

import AdvancedSettings from "./AdvancedSettings"
import {DynamicFormField} from "./DynamicFormField"

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
    const [form] = Form.useForm()
    const [submitLoading, setSubmitLoading] = useState(false)
    const [traceTree, setTraceTree] = useState<{
        trace: Record<string, any> | string | null
    }>({
        trace: null,
    })

    const evalFields = useMemo(
        () =>
            Object.keys(selectedEvaluator?.settings_template || {})
                .filter((key) => !!selectedEvaluator?.settings_template[key]?.type)
                .map((key) => ({
                    key,
                    ...selectedEvaluator?.settings_template[key]!,
                    advanced: selectedEvaluator?.settings_template[key]?.advanced || false,
                })),
        [selectedEvaluator],
    )

    const advancedSettingsFields = evalFields.filter((field) => field.advanced)
    const basicSettingsFields = evalFields.filter((field) => !field.advanced)

    const onSubmit = (values: CreateEvaluationConfigData) => {
        try {
            setSubmitLoading(true)
            if (!selectedEvaluator.key) throw new Error("No selected key")
            const settingsValues = values.settings_values || {}

            const data = {
                ...values,
                evaluator_key: selectedEvaluator.key,
                settings_values: settingsValues,
            }

            ;(editMode
                ? updateEvaluatorConfig(editEvalEditValues?.id!, data)
                : createEvaluatorConfig(appId, data)
            )
                .then(onSuccess)
                .catch(console.error)
                .finally(() => setSubmitLoading(false))
        } catch (error: any) {
            setSubmitLoading(false)
            console.error(error)
            message.error(error.message)
        }
    }

    useEffect(() => {
        form.resetFields()
        if (editMode) {
            form.setFieldsValue(editEvalEditValues)
        } else if (cloneConfig) {
            form.setFieldValue("settings_values", editEvalEditValues?.settings_values)
        }
    }, [editMode, cloneConfig])

    return (
        <section className="flex flex-col w-full h-[calc(100vh-84px)] gap-2">
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

            <div className="flex gap-4 w-full h-full px-4 overflow-auto">
                <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0 h-full w-[50%]">
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
                                    <Typography.Text className={classes.formTitleText}>
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
                            ) : (
                                ""
                            )}

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

                <Divider type="vertical" className="h-full sticky" />

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
    )
}

export default ConfigureEvaluator
