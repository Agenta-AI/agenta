import {useEffect, useMemo, useState} from "react"

import {CloseOutlined} from "@ant-design/icons"
import {ArrowLeft, CaretDoubleRight} from "@phosphor-icons/react"
import {Button, Flex, Form, Input, message, Space, Tooltip, Typography} from "antd"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {useAppId} from "@/oss/hooks/useAppId"
import {isDemo} from "@/oss/lib/helpers/utils"
import {Evaluator, EvaluatorConfig, JSSTheme, testset, Variant} from "@/oss/lib/Types"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    updateEvaluatorConfig,
} from "@/oss/services/evaluations/api"

import AdvancedSettings from "./AdvancedSettings"
import {DynamicFormField} from "./DynamicFormField"

const DebugSection: any = dynamic(
    () =>
        import(
            "@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/DebugSection"
        ),
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
    setDebugEvaluator: React.Dispatch<React.SetStateAction<boolean>>
    debugEvaluator: boolean
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
        maxWidth: "100%",
        overflow: "hidden",
        "& .ant-form-item": {
            marginBottom: 0,
        },
        "& .ant-form-item-label": {
            paddingBottom: theme.paddingXXS,
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
    debugEvaluator,
    setDebugEvaluator,
    selectedTestset,
    setSelectedTestset,
    appId: appIdOverride,
}: ConfigureEvaluatorProps) => {
    const routeAppId = useAppId()
    const appId = appIdOverride ?? routeAppId
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
        <div className="flex flex-col gap-6 h-full">
            <div className="flex items-center justify-between">
                <Space className={classes.headerText}>
                    {editMode ? (
                        <>
                            <Button
                                icon={<ArrowLeft size={14} />}
                                className="flex items-center justify-center"
                                onClick={() => {
                                    setCurrent(0)
                                    setEditMode(false)
                                    setCloneConfig(false)
                                    setEditEvalEditValues(null)
                                }}
                            />
                            <Typography.Text>Configure evaluator</Typography.Text>
                        </>
                    ) : (
                        <>
                            <Button
                                icon={<ArrowLeft size={14} />}
                                className="flex items-center justify-center"
                                onClick={() => {
                                    setCurrent(1)
                                    setEditMode(false)
                                    setCloneConfig(false)
                                    setEditEvalEditValues(null)
                                }}
                            />
                            <Typography.Text>Step 2/2:</Typography.Text>
                            <Typography.Text>Configure new evaluator</Typography.Text>
                        </>
                    )}
                </Space>

                <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
            </div>

            <Flex gap={16} className="h-full overflow-y-hidden w-full max-w-full">
                <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">
                    <Space direction="vertical">
                        <Flex justify="space-between">
                            <Typography.Text className={classes.title}>
                                {selectedEvaluator.name}
                            </Typography.Text>

                            <Tooltip
                                title={
                                    isDemo()
                                        ? ""
                                        : "Test evaluator feature available in Cloud/Enterprise editions only"
                                }
                                placement="bottom"
                            >
                                <Button
                                    size="small"
                                    onClick={() => setDebugEvaluator(!debugEvaluator)}
                                    disabled={!isDemo()}
                                >
                                    {debugEvaluator ? (
                                        <div className="flex items-center gap-2">
                                            <CloseOutlined />
                                            Test
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            Test
                                            <CaretDoubleRight />
                                        </div>
                                    )}
                                </Button>
                            </Tooltip>
                        </Flex>
                        <Typography.Text type="secondary">
                            {selectedEvaluator.description}
                        </Typography.Text>
                    </Space>

                    <div className="flex-1 overflow-y-hidden">
                        <Form
                            requiredMark={false}
                            form={form}
                            name="new-evaluator"
                            onFinish={onSubmit}
                            layout="vertical"
                            className={classes.formContainer}
                        >
                            <Space direction="vertical" size={4}>
                                <div className="flex gap-4">
                                    <Form.Item
                                        name="name"
                                        label="Name"
                                        rules={[
                                            {required: true, message: "This field is required"},
                                        ]}
                                        className="flex-1"
                                    >
                                        <Input />
                                    </Form.Item>
                                </div>
                            </Space>

                            {basicSettingsFields.length ? (
                                <Space
                                    direction="vertical"
                                    size={4}
                                    className="flex-1 overflow-y-auto w-full max-w-full"
                                >
                                    <Typography.Text className={classes.formTitleText}>
                                        Parameters
                                    </Typography.Text>
                                    {basicSettingsFields.map((field) => (
                                        <DynamicFormField
                                            {...field}
                                            key={field.key}
                                            traceTree={traceTree}
                                            name={["settings_values", field.key]}
                                        />
                                    ))}
                                </Space>
                            ) : (
                                ""
                            )}

                            {advancedSettingsFields.length > 0 && (
                                <AdvancedSettings
                                    settings={advancedSettingsFields}
                                    selectedTestcase={selectedTestcase}
                                />
                            )}
                        </Form>
                    </div>

                    <Flex gap={8} justify="end">
                        <Button type="text" onClick={() => form.resetFields()}>
                            Reset
                        </Button>
                        <Button type="primary" loading={submitLoading} onClick={form.submit}>
                            Save configuration
                        </Button>
                    </Flex>
                </div>

                <DebugSection
                    selectedEvaluator={selectedEvaluator}
                    selectedTestcase={selectedTestcase}
                    selectedVariant={selectedVariant}
                    setTraceTree={setTraceTree}
                    debugEvaluator={debugEvaluator}
                    form={form}
                    testsets={testsets}
                    traceTree={traceTree}
                    variants={variants}
                    setSelectedVariant={setSelectedVariant}
                    setSelectedTestcase={setSelectedTestcase}
                    selectedTestset={selectedTestset}
                    setSelectedTestset={setSelectedTestset}
                />
            </Flex>
        </div>
    )
}

export default ConfigureEvaluator
