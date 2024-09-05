import {BaseResponse, Evaluator, JSSTheme, Parameter, testset, Variant} from "@/lib/Types"
import {CloseCircleOutlined, CloseOutlined} from "@ant-design/icons"
import {
    ArrowLeft,
    CaretDoubleLeft,
    CaretDoubleRight,
    ClockClockwise,
    Database,
    Lightning,
    Play,
} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Flex,
    Form,
    Input,
    message,
    Select,
    Space,
    Tag,
    Tooltip,
    Typography,
} from "antd"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import AdvancedSettings from "./AdvancedSettings"
import {DynamicFormField} from "./DynamicFormField"
import EvaluatorVariantModal from "./EvaluatorVariantModal"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    createEvaluatorDataMapping,
    createEvaluatorRunExecution,
    updateEvaluatorConfig,
} from "@/services/evaluations/api"
import {useAppId} from "@/hooks/useAppId"
import {useLocalStorage} from "usehooks-ts"
import {getAllVariantParameters} from "@/lib/helpers/variantHelper"
import {apiKeyObject, getStringOrJson, removeKeys} from "@/lib/helpers/utils"
import {callVariant} from "@/services/api"
import {Editor} from "@monaco-editor/react"
import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {isBaseResponse, isFuncResponse} from "@/lib/helpers/playgroundResp"
import {formatCurrency, formatLatency} from "@/lib/helpers/formatters"
import {fromBaseResponseToTraceSpanType, transformTraceTreeToJson} from "@/lib/transformers"

type ConfigureEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    onSuccess: () => void
    selectedEvaluator: Evaluator
    variants: Variant[] | null
    testsets: testset[] | null
    selectedTestcase: Record<string, any> | null
    setSelectedTestcase: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
    setSelectedVariant: React.Dispatch<React.SetStateAction<Variant | null>>
    selectedVariant: Variant | null
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
        overflowY: "auto",
        maxHeight: 580,
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
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
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
    setSelectedTestcase,
    selectedVariant,
    setSelectedVariant,
}: ConfigureEvaluatorProps) => {
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const [form] = Form.useForm()
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const [openVariantModal, setOpenVariantModal] = useState(false)
    const [submitLoading, setSubmitLoading] = useState(false)
    const [optInputs, setOptInputs] = useState<Parameter[] | null>(null)
    const [optParams, setOptParams] = useState<Parameter[] | null>(null)
    const [isChatVariant, setIsChatVariant] = useState(false)
    const abortControllersRef = useRef<AbortController | null>(null)
    const [isRunningVariant, setIsRunningVariant] = useState(false)
    const [variantResult, setVariantResult] = useState("")
    const [traceTree, setTraceTree] = useState<{
        testcase: Record<string, any> | null
    }>({
        testcase: null,
    })
    const [baseResponseData, setBaseResponseData] = useState<BaseResponse | null>(null)
    const [outputResult, setOutputResult] = useState("")
    const [isLoadingResult, setIsLoadingResult] = useState(false)

    const fetchEvalMapper = async () => {
        if (!baseResponseData) return

        try {
            setIsLoadingResult(true)
            const mapResponse = await createEvaluatorDataMapping({
                inputs: baseResponseData,
                mapping: {
                    ...form.getFieldValue("settings_values"),
                },
            })

            const runResponse = await createEvaluatorRunExecution(selectedEvaluator.key, {
                inputs: {...mapResponse.outputs},
                settings: {
                    ...form.getFieldValue("settings_values"),
                },
                ...(selectedEvaluator.requires_llm_api_keys ||
                form.getFieldValue("settings_values")?.requires_llm_api_keys
                    ? {credentials: apiKeyObject()}
                    : {}),
            })
            setOutputResult(getStringOrJson(runResponse))
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoadingResult(false)
        }
    }

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
            ;(false
                ? updateEvaluatorConfig("initialValues?.id"!, data)
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
        if (!selectedVariant || !selectedTestcase) return

        const fetchParameters = async () => {
            try {
                const {parameters, inputs, isChatVariant} = await getAllVariantParameters(
                    appId,
                    selectedVariant,
                )
                setOptInputs(inputs)
                setOptParams(parameters)
                setIsChatVariant(isChatVariant)
            } catch (error) {
                console.error(error)
            }
        }

        fetchParameters()
    }, [selectedVariant])

    const handleRunVariant = async () => {
        if (!selectedTestcase || !selectedVariant) return
        const controller = new AbortController()
        abortControllersRef.current = controller

        try {
            setIsRunningVariant(true)
            const result = await callVariant(
                isChatVariant ? removeKeys(selectedTestcase, ["chat"]) : selectedTestcase,
                optInputs || [],
                optParams || [],
                appId,
                selectedVariant.baseId,
                isChatVariant ? selectedTestcase.chat || [{}] : [],
                controller.signal,
                true,
            )

            if (typeof result === "string") {
                setVariantResult(getStringOrJson({data: result}))
                setTraceTree({...{data: result}, testcase: selectedTestcase})
            } else if (isFuncResponse(result)) {
                setVariantResult(getStringOrJson(result))
                setTraceTree({...{data: result}, testcase: selectedTestcase})
            } else if (isBaseResponse(result)) {
                setBaseResponseData(result)
                const {trace, data} = result
                setVariantResult(
                    getStringOrJson({
                        ...(typeof data === "string" ? {message: data} : data),
                        cost: formatCurrency(trace?.cost),
                        usage: trace?.usage,
                        latency: formatLatency(trace?.latency),
                    }),
                )
                if (trace?.spans) {
                    setTraceTree({
                        ...transformTraceTreeToJson(
                            fromBaseResponseToTraceSpanType(trace.spans, trace.trace_id)[0],
                        ),

                        testcase: selectedTestcase,
                    })
                }
            } else {
                console.error("Unknown response type:", result)
            }
        } catch (error: any) {
            if (!controller.signal.aborted) {
                console.error(error)
                message.error(error.message)
                setVariantResult("")
            }
        } finally {
            setIsRunningVariant(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="flex items-center justify-between">
                <Space className={classes.headerText}>
                    <Button
                        icon={<ArrowLeft size={14} />}
                        className="flex items-center justify-center"
                        onClick={() => setCurrent(1)}
                    />
                    <Typography.Text>Step 2/2:</Typography.Text>
                    <Typography.Text>Configure new evaluator</Typography.Text>
                    <Tag>{selectedEvaluator.name}</Tag>
                </Space>

                <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
            </div>

            <Flex gap={16} className="h-full">
                <div className="flex-1 flex flex-col gap-4">
                    <div>
                        <Flex justify="space-between">
                            <Typography.Text className={classes.title}>
                                {selectedEvaluator.name}
                            </Typography.Text>
                            <Space>
                                <Button
                                    size="small"
                                    className="flex items-center gap-2"
                                    disabled={true}
                                >
                                    <ClockClockwise />
                                    View history
                                </Button>
                                <Button
                                    size="small"
                                    onClick={() => setDebugEvaluator(!debugEvaluator)}
                                >
                                    {debugEvaluator ? (
                                        <div className="flex items-center gap-2">
                                            Debug
                                            <CaretDoubleRight />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <CaretDoubleLeft />
                                            Debug
                                        </div>
                                    )}
                                </Button>
                            </Space>
                        </Flex>
                        <Typography.Text type="secondary">
                            {selectedEvaluator.description}
                        </Typography.Text>
                    </div>

                    <div className="flex-1">
                        <Form
                            requiredMark={false}
                            form={form}
                            name="new-evaluator"
                            onFinish={onSubmit}
                            layout="vertical"
                            className={classes.formContainer}
                        >
                            <Space direction="vertical" size={4}>
                                <Typography.Text className={classes.formTitleText}>
                                    Identifier
                                </Typography.Text>

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
                                    {/* <Form.Item
                                        name="label"
                                        label="Label"
                                        rules={[
                                            {required: true, message: "This field is required"},
                                        ]}
                                        className="flex-1"
                                    >
                                        <Select
                                            mode="multiple"
                                            allowClear
                                            placeholder="Please select"
                                            defaultValue={["item1"]}
                                            options={[
                                                {label: "item1", value: "item1"},
                                                {label: "item2", value: "item2"},
                                            ]}
                                        />
                                    </Form.Item> */}
                                </div>
                            </Space>

                            {basicSettingsFields.length ? (
                                <Space direction="vertical" size={4}>
                                    <Typography.Text className={classes.formTitleText}>
                                        Parameters
                                    </Typography.Text>
                                    {basicSettingsFields.map((field) => {
                                        const {testcase, ...tree} = traceTree

                                        return (
                                            <DynamicFormField
                                                {...field}
                                                key={field.key}
                                                traceTree={tree}
                                                name={["settings_values", field.key]}
                                            />
                                        )
                                    })}
                                </Space>
                            ) : (
                                ""
                            )}

                            {advancedSettingsFields.length > 0 && (
                                <AdvancedSettings
                                    settings={advancedSettingsFields}
                                    selectedTestcase={{testcase: traceTree.testcase}}
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

                {debugEvaluator && (
                    <>
                        <Divider type="vertical" className="h-full" />

                        <div className="flex-1 flex flex-col gap-4">
                            <Space direction="vertical" size={0}>
                                <Typography.Text className={classes.title}>
                                    Debug evaluator
                                </Typography.Text>
                                <Typography.Text type="secondary">
                                    Test your evaluator by generating a test data
                                </Typography.Text>
                            </Space>

                            <Flex justify="space-between">
                                <Typography.Text className={classes.title}>
                                    Generate test data
                                </Typography.Text>
                                <Space>
                                    <Tooltip
                                        title={testsets?.length === 0 ? "No testset" : ""}
                                        placement="bottom"
                                    >
                                        <Button
                                            size="small"
                                            className="flex items-center gap-2"
                                            onClick={() => setCurrent(3)}
                                            disabled={testsets?.length === 0}
                                        >
                                            <Database />
                                            Load test case
                                        </Button>
                                    </Tooltip>
                                    <Button
                                        size="small"
                                        className="flex items-center gap-2"
                                        onClick={() => setOpenVariantModal(true)}
                                    >
                                        <Lightning />
                                        Select variant
                                    </Button>
                                    {isRunningVariant ? (
                                        <Button
                                            size="small"
                                            danger
                                            onClick={() => {
                                                if (abortControllersRef.current) {
                                                    abortControllersRef.current.abort()
                                                }
                                            }}
                                            type="primary"
                                        >
                                            <CloseCircleOutlined />
                                            Cancel
                                        </Button>
                                    ) : (
                                        <Button
                                            size="small"
                                            className="flex items-center gap-2"
                                            disabled={!selectedTestcase || !selectedVariant}
                                            onClick={handleRunVariant}
                                            loading={isRunningVariant}
                                        >
                                            <Play />
                                            Run variant
                                        </Button>
                                    )}
                                </Space>
                            </Flex>

                            <div className="flex-1 flex flex-col h-full">
                                <Typography.Text className={classes.formTitleText}>
                                    JSON
                                </Typography.Text>
                                <Editor
                                    className={classes.editor}
                                    width="100%"
                                    language="json"
                                    theme={`vs-${appTheme}`}
                                    value={getStringOrJson(traceTree)}
                                    onChange={(value) => {
                                        try {
                                            if (value) {
                                                const parsedValue = JSON.parse(value)
                                                setTraceTree(parsedValue)
                                            }
                                        } catch (error) {}
                                    }}
                                    options={{wordWrap: "on"}}
                                />
                            </div>

                            <div className="flex-1 flex flex-col h-full">
                                <Typography.Text className={classes.formTitleText}>
                                    App Output
                                </Typography.Text>
                                <Editor
                                    className={classes.editor}
                                    width="100%"
                                    language="json"
                                    theme={`vs-${appTheme}`}
                                    value={variantResult}
                                    options={{wordWrap: "on", readOnly: true}}
                                />
                            </div>

                            <div className="flex flex-col gap-2 flex-1 h-full">
                                <Flex justify="space-between">
                                    <Typography.Text className={classes.formTitleText}>
                                        Output
                                    </Typography.Text>
                                    <Tooltip
                                        title={baseResponseData ? "" : "BaseResponse feature"}
                                        placement="bottom"
                                    >
                                        <Button
                                            className="flex items-center gap-2"
                                            size="small"
                                            onClick={fetchEvalMapper}
                                            disabled={!baseResponseData}
                                            loading={isLoadingResult}
                                        >
                                            <Play /> Run evaluator
                                        </Button>
                                    </Tooltip>
                                </Flex>

                                <Editor
                                    className={classes.editor}
                                    width="100%"
                                    language="json"
                                    theme={`vs-${appTheme}`}
                                    options={{wordWrap: "on", readOnly: true}}
                                    value={outputResult}
                                />
                            </div>
                        </div>
                    </>
                )}
            </Flex>

            <EvaluatorVariantModal
                variants={variants}
                open={openVariantModal}
                onCancel={() => setOpenVariantModal(false)}
                setSelectedVariant={setSelectedVariant}
                selectedVariant={selectedVariant}
            />
        </div>
    )
}

export default ConfigureEvaluator
