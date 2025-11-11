// @ts-nocheck
import {Dispatch, SetStateAction, useMemo, useRef, useState} from "react"

import {getAllMetadata} from "@agenta/oss/src/lib/hooks/useStatelessVariants/state"
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    MoreOutlined,
} from "@ant-design/icons"
import {Editor} from "@monaco-editor/react"
import {Database, Lightning, Play} from "@phosphor-icons/react"
import {
    Button,
    Divider,
    Dropdown,
    Flex,
    FormInstance,
    message,
    Space,
    Tabs,
    Tooltip,
    Typography,
} from "antd"
import yaml from "js-yaml"
import {createUseStyles} from "react-jss"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import {useAppId} from "@/oss/hooks/useAppId"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {mapTestcaseAndEvalValues, transformTraceKeysInSettings} from "@/oss/lib/helpers/evaluate"
import {buildNodeTree, observabilityTransformer} from "@/oss/lib/helpers/observability_helpers"
import {isBaseResponse, isFuncResponse} from "@/oss/lib/helpers/playgroundResp"
import {
    apiKeyObject,
    extractChatMessages,
    getStringOrJson,
    removeKeys,
    safeParse,
} from "@/oss/lib/helpers/utils"
import {getAllVariantParameters} from "@/oss/lib/helpers/variantHelper"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {
    buildNodeTreeV3,
    fromBaseResponseToTraceSpanType,
    transformTraceTreeToJson,
} from "@/oss/lib/transformers"
import {
    BaseResponse,
    ChatMessage,
    Evaluator,
    JSSTheme,
    Parameter,
    testset,
    Variant,
} from "@/oss/lib/Types"
import {callVariant} from "@/oss/services/api"
import {
    createEvaluatorDataMapping,
    createEvaluatorRunExecution,
} from "@/oss/services/evaluations/api_ee"
import {AgentaNodeDTO} from "@/oss/services/observability/types"

import EvaluatorTestcaseModal from "./EvaluatorTestcaseModal"
import EvaluatorVariantModal from "./EvaluatorVariantModal"
interface DebugSectionProps {
    selectedTestcase: {
        testcase: Record<string, any> | null
    }
    selectedVariant: EnhancedVariant
    // NonNullable<ReturnType<typeof useStatelessVariants>["variants"]>[number]
    testsets: testset[] | null
    traceTree: {
        trace: Record<string, any> | string | null
    }
    setTraceTree: Dispatch<
        SetStateAction<{
            trace: Record<string, any> | string | null
        }>
    >
    selectedEvaluator: Evaluator
    form: FormInstance<any>
    debugEvaluator: boolean
    setSelectedVariant: Dispatch<SetStateAction<Variant | null>>
    variants: Variant[] | null
    setSelectedTestcase: Dispatch<
        SetStateAction<{
            testcase: Record<string, any> | null
        }>
    >
    setSelectedTestset: Dispatch<SetStateAction<string>>
    selectedTestset: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        fontSize: theme.fontSizeLG,
        fontWeight: theme.fontWeightMedium,
        lineHeight: theme.lineHeightLG,
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
    variantTab: {
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        "& .ant-tabs-content-holder": {
            flex: 1,
            minHeight: 0,
        },
        "& .ant-tabs-content": {
            height: "100%",
            overflow: "hidden",
            "& .ant-tabs-tabpane": {
                height: "100%",
                overflow: "hidden",
            },
        },
    },
}))

const DebugSection = ({
    selectedTestcase,
    selectedVariant: _selectedVariant,
    testsets,
    traceTree,
    setTraceTree,
    selectedEvaluator,
    form,
    debugEvaluator,
    variants,
    setSelectedVariant,
    setSelectedTestcase,
    selectedTestset,
    setSelectedTestset,
}: DebugSectionProps) => {
    const appId = useAppId()
    const classes = useStyles()
    const {appTheme} = useAppTheme()
    const [baseResponseData, setBaseResponseData] = useState<BaseResponse | null>(null)
    const [outputResult, setOutputResult] = useState("")
    const [isLoadingResult, setIsLoadingResult] = useState(false)
    const abortControllersRef = useRef<AbortController | null>(null)
    const [isRunningVariant, setIsRunningVariant] = useState(false)
    const [variantResult, setVariantResult] = useState("")
    const [openVariantModal, setOpenVariantModal] = useState(false)
    const [openTestcaseModal, setOpenTestcaseModal] = useState(false)
    const [variantStatus, setVariantStatus] = useState({
        success: false,
        error: false,
    })
    const [evalOutputStatus, setEvalOutputStatus] = useState({
        success: false,
        error: false,
    })
    const {secrets} = useVaultSecret()

    const selectedVariant = useMemo(() => {
        const revs = _selectedVariant.revisions
        // find the most recent revision by looking at the updatedAtTimestamp
        const variant = revs.sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
        return variant
    }, [_selectedVariant])

    const activeTestset = useMemo(() => {
        return testsets?.find((item) => item._id === selectedTestset)
    }, [selectedTestset, testsets])

    const fetchEvalMapper = async () => {
        if (!baseResponseData || !selectedTestcase.testcase) return

        try {
            setEvalOutputStatus({success: false, error: false})
            setIsLoadingResult(true)

            const settingsValues = form.getFieldValue("settings_values") || {}
            const {testcaseObj, evalMapObj} = mapTestcaseAndEvalValues(
                settingsValues,
                selectedTestcase.testcase,
            )
            let outputs = {}

            if (Object.keys(evalMapObj).length && selectedEvaluator.key.startsWith("rag_")) {
                const mapResponse = await createEvaluatorDataMapping({
                    inputs: baseResponseData,
                    mapping: transformTraceKeysInSettings(evalMapObj),
                })
                outputs = {...outputs, ...mapResponse.outputs}
            }

            if (Object.keys(testcaseObj).length) {
                outputs = {...outputs, ...testcaseObj}
            }

            if (!selectedEvaluator.key.startsWith("rag_")) {
                const correctAnswerKey = settingsValues.correct_answer_key
                const groundTruthKey =
                    typeof correctAnswerKey === "string" && correctAnswerKey.startsWith("testcase.")
                        ? correctAnswerKey.split(".")[1]
                        : correctAnswerKey

                outputs = {
                    ...selectedTestcase["testcase"],
                    ground_truth: selectedTestcase["testcase"][groundTruthKey],
                    prediction: variantResult,
                    ...(selectedEvaluator.key === "auto_custom_code_run" ? {app_config: {}} : {}),
                }
            }

            const runResponse = await createEvaluatorRunExecution(selectedEvaluator.key, {
                inputs: outputs,
                settings: transformTraceKeysInSettings(settingsValues),
                ...(selectedEvaluator.requires_llm_api_keys || settingsValues?.requires_llm_api_keys
                    ? {credentials: apiKeyObject(secrets)}
                    : {}),
            })
            setEvalOutputStatus({success: true, error: false})

            setOutputResult(
                getStringOrJson(
                    runResponse.outputs.success !== undefined
                        ? runResponse.outputs.success
                        : runResponse.outputs.score !== undefined
                          ? runResponse.outputs.score
                          : runResponse.outputs,
                ),
            )
        } catch (error: any) {
            console.error(error)
            setEvalOutputStatus({success: false, error: true})
            if (error.response.data.detail) {
                setOutputResult(getStringOrJson(formatJson(error.response.data.detail)))
            } else {
                setOutputResult("Error occured")
            }
        } finally {
            setIsLoadingResult(false)
        }
    }

    const handleRunVariant = async () => {
        if (!selectedTestcase.testcase || !selectedVariant) return
        const controller = new AbortController()
        abortControllersRef.current = controller

        try {
            setVariantStatus({success: false, error: false})
            setIsRunningVariant(true)

            const params = {} as {
                inputs: Parameter[]
                parameters: unknown
                isChatVariant: boolean
                isCustom: boolean
                messages: ChatMessage[]
            }

            if (selectedVariant.parameters) {
                params.inputs = selectedVariant.inputParams
                params.parameters = transformToRequestBody({
                    variant: selectedVariant,
                    allMetadata: getAllMetadata(),
                })
                params.isChatVariant = selectedVariant.isChatVariant
                params.messages = params.isChatVariant
                    ? extractChatMessages(selectedTestcase.testcase)
                    : []
                params.isCustom = selectedVariant.isCustom
            } else {
                const {parameters, inputs, isChatVariant} = await getAllVariantParameters(
                    appId,
                    selectedVariant,
                )
                params.parameters = parameters
                params.inputs = inputs
                params.isChatVariant = isChatVariant
                params.messages = params.isChatVariant
                    ? JSON.parse(selectedTestcase.testcase.chat) || [{}]
                    : []
                params.isCustom = selectedVariant.isCustom
            }

            const result = await callVariant(
                params.isChatVariant
                    ? removeKeys(selectedTestcase.testcase, ["chat"])
                    : selectedTestcase.testcase,
                params.inputs || [],
                params.parameters || [],
                appId,
                selectedVariant.baseId,
                params.messages,
                controller.signal,
                true,
                selectedVariant.parameters && !!selectedVariant._parentVariant,
                params.isCustom,
                selectedVariant?.uriObject,
                selectedVariant.variantId,
            )

            if (typeof result === "string") {
                setVariantResult(getStringOrJson(result))
                setTraceTree({trace: result})
                setVariantStatus({success: true, error: false})
            } else if (isFuncResponse(result)) {
                setVariantResult(getStringOrJson(result))
                setTraceTree({trace: result})
                setVariantStatus({success: true, error: false})
            } else if (isBaseResponse(result)) {
                setBaseResponseData(result)
                const {trace, tree, data} = result
                setVariantResult(getStringOrJson(data))

                if (trace && trace?.spans) {
                    setTraceTree({
                        trace: transformTraceTreeToJson(
                            fromBaseResponseToTraceSpanType(trace.spans, trace.trace_id)[0],
                        ),
                    })
                }

                if (tree) {
                    const traceTree = tree.nodes
                        .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                        .flatMap((item: any) => observabilityTransformer(item))
                        .map((item) => {
                            const {key, children, ...trace} = item

                            return trace
                        })[0]

                    setTraceTree({
                        trace: buildNodeTreeV3(traceTree),
                    })
                }
                setVariantStatus({success: true, error: false})
            } else {
                console.error("Unknown response type:", result)
            }
        } catch (error: any) {
            if (!controller.signal.aborted) {
                console.error("error: ", error)
                message.error(error.message)
                if (error.response.data.detail) {
                    setVariantResult(getStringOrJson(error.response.data.detail))
                } else {
                    setVariantResult("Error occured")
                }
                setVariantStatus({success: false, error: true})
            }
        } finally {
            setIsRunningVariant(false)
        }
    }

    const formatJson = (data: Record<string, any>): Record<string, any> => {
        const formattedJson: Record<string, any> = {}

        for (const [key, value] of Object.entries(data)) {
            if (typeof value === "string") {
                if (value.includes("Traceback")) {
                    formattedJson[key] = value.split("\n").map((line) => line.trim())
                } else {
                    const parsedValue = safeParse(value, value)
                    if (typeof parsedValue === "string") {
                        formattedJson[key] = parsedValue.replace(/\\n/g, "\n").replace(/\\"/g, '"')
                    } else {
                        formattedJson[key] = parsedValue
                    }
                }
            } else if (typeof value === "object" && value !== null) {
                formattedJson[key] = formatJson(value)
            } else {
                formattedJson[key] = value
            }
        }

        return formattedJson
    }

    const formatOutput = (str: string) => {
        try {
            const parsed = JSON.parse(str)
            return yaml.dump(parsed)
        } catch (e) {
            return str
        }
    }

    return (
        <>
            {debugEvaluator && (
                <>
                    <Divider type="vertical" className="h-full" />

                    <div className="flex-1 flex flex-col gap-4 min-w-0 overflow-hidden">
                        <Space direction="vertical" size={0}>
                            <Typography.Text className={classes.title}>
                                Test evaluator
                            </Typography.Text>
                            <Typography.Text type="secondary">
                                Test your evaluator by generating a test data
                            </Typography.Text>
                        </Space>

                        <div className="flex-[0.3] flex flex-col gap-1 min-h-0">
                            <div className="flex items-center justify-between">
                                <Space size={5}>
                                    <Typography.Text className={classes.formTitleText}>
                                        Testcase
                                    </Typography.Text>

                                    {activeTestset && selectedTestcase.testcase && (
                                        <>
                                            <CheckCircleOutlined style={{color: "green"}} />
                                            <Typography.Text type="secondary">
                                                loaded from {activeTestset.name}
                                            </Typography.Text>
                                        </>
                                    )}
                                </Space>

                                <Tooltip
                                    title={testsets?.length === 0 ? "No testset" : ""}
                                    placement="bottom"
                                >
                                    <Button
                                        size="small"
                                        className="flex items-center gap-2"
                                        onClick={() => setOpenTestcaseModal(true)}
                                        disabled={testsets?.length === 0}
                                    >
                                        <Database />
                                        Load testcase
                                    </Button>
                                </Tooltip>
                            </div>

                            <div className="flex-1 w-full overflow-hidden">
                                <Editor
                                    className={classes.editor}
                                    width="100%"
                                    height="100%"
                                    language="json"
                                    theme={`vs-${appTheme}`}
                                    value={getStringOrJson(
                                        selectedTestcase.testcase ? formatJson(selectedTestcase) : "",
                                    )}
                                    onChange={(value) => {
                                        try {
                                            if (value) {
                                                const parsedValue = JSON.parse(value)
                                                setSelectedTestcase(parsedValue)
                                            }
                                        } catch (error) {
                                            console.error("Failed to parse test case JSON", error)
                                        }
                                    }}
                                    options={{
                                        wordWrap: "on",
                                        minimap: {enabled: false},
                                        lineNumbers: "off",
                                        scrollBeyondLastLine: false,
                                    }}
                                />
                            </div>
                        </div>

                        <div className="flex-[0.45] flex flex-col min-h-0 overflow-hidden">
                            <div className="flex items-center justify-between">
                                <Space size={5}>
                                    <Typography.Text className={classes.formTitleText}>
                                        Application
                                    </Typography.Text>
                                    {variantStatus.success && (
                                        <>
                                            <CheckCircleOutlined style={{color: "green"}} />
                                            <Typography.Text type="secondary">
                                                Success
                                            </Typography.Text>
                                        </>
                                    )}
                                    {variantStatus.error && (
                                        <ExclamationCircleOutlined style={{color: "red"}} />
                                    )}
                                </Space>

                                {isRunningVariant ? (
                                    <Button
                                        size="small"
                                        className="w-[120px]"
                                        danger
                                        onClick={() => {
                                            if (abortControllersRef.current) {
                                                abortControllersRef.current.abort()
                                            }
                                        }}
                                    >
                                        <CloseCircleOutlined />
                                        Cancel
                                    </Button>
                                ) : (
                                    <Dropdown.Button
                                        className="w-fit"
                                        disabled={!selectedTestcase.testcase}
                                        size="small"
                                        onClick={handleRunVariant}
                                        loading={isRunningVariant}
                                        icon={<MoreOutlined />}
                                        menu={{
                                            items: [
                                                {
                                                    key: "change_variant",
                                                    icon: <Lightning />,
                                                    label: "Change Variant",
                                                    onClick: () => setOpenVariantModal(true),
                                                },
                                            ],
                                        }}
                                    >
                                        <div
                                            className="flex items-center gap-2"
                                            key={
                                                selectedVariant?.variantId ||
                                                selectedVariant?.variantName ||
                                                "default"
                                            }
                                        >
                                            <Play />
                                            {/* Adding key above ensures React re-renders this label when variant changes */}
                                            Run {selectedVariant?.variantName || "variant"}
                                        </div>
                                    </Dropdown.Button>
                                )}
                            </div>

                            <Tabs
                                defaultActiveKey="output"
                                className={classes.variantTab}
                                items={[
                                    {
                                        key: "output",
                                        label: "Output",
                                        children: (
                                            <div className="w-full h-full overflow-hidden">
                                                <Editor
                                                    className={classes.editor}
                                                    width="100%"
                                                    height="100%"
                                                    language="markdown"
                                                    theme={`vs-${appTheme}`}
                                                    value={variantResult}
                                                    options={{
                                                        wordWrap: "on",
                                                        minimap: {enabled: false},
                                                        lineNumbers: "off",
                                                        lineDecorationsWidth: 0,
                                                        scrollBeyondLastLine: false,
                                                    }}
                                                    onChange={(value) => {
                                                        if (value) {
                                                            setVariantResult(value)
                                                        }
                                                    }}
                                                />
                                            </div>
                                        ),
                                    },
                                    {
                                        key: "trace",
                                        label: "Trace",
                                        children: (
                                            <div className="w-full h-full overflow-hidden">
                                                <Editor
                                                    className={classes.editor}
                                                    width="100%"
                                                    height="100%"
                                                    language="json"
                                                    theme={`vs-${appTheme}`}
                                                    value={
                                                        traceTree.trace
                                                            ? getStringOrJson(traceTree)
                                                            : ""
                                                    }
                                                    options={{
                                                        wordWrap: "on",
                                                        minimap: {enabled: false},
                                                        lineNumbers: "off",
                                                        scrollBeyondLastLine: false,
                                                    }}
                                                    onChange={(value) => {
                                                        try {
                                                            if (value) {
                                                                const parsedValue = JSON.parse(value)
                                                                setTraceTree(parsedValue)
                                                            }
                                                        } catch (error) {
                                                            console.error(
                                                                "Failed to parse trace tree JSON",
                                                                error,
                                                            )
                                                        }
                                                    }}
                                                />
                                            </div>
                                        ),
                                    },
                                ]}
                            />
                        </div>

                        <div className="flex flex-col gap-1 flex-[0.25] min-h-0 overflow-hidden">
                            <Flex justify="space-between">
                                <Space size={5}>
                                    <Typography.Text className={classes.formTitleText}>
                                        Evaluator Output
                                    </Typography.Text>
                                    {evalOutputStatus.success && (
                                        <>
                                            <CheckCircleOutlined style={{color: "green"}} />
                                            <Typography.Text type="secondary">
                                                Successful
                                            </Typography.Text>
                                        </>
                                    )}
                                    {evalOutputStatus.error && (
                                        <ExclamationCircleOutlined style={{color: "red"}} />
                                    )}
                                </Space>
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

                            <div className="w-full h-full overflow-hidden">
                                <Editor
                                    className={classes.editor}
                                    width="100%"
                                    height="100%"
                                    language="yaml"
                                    theme={`vs-${appTheme}`}
                                    options={{
                                        wordWrap: "on",
                                        minimap: {enabled: false},
                                        readOnly: true,
                                        lineNumbers: "off",
                                        lineDecorationsWidth: 0,
                                        scrollBeyondLastLine: false,
                                    }}
                                    value={formatOutput(outputResult)}
                                />
                            </div>
                        </div>
                    </div>
                </>
            )}

            <EvaluatorVariantModal
                variants={variants}
                open={openVariantModal}
                onCancel={() => setOpenVariantModal(false)}
                setSelectedVariant={setSelectedVariant}
                selectedVariant={selectedVariant}
            />

            {testsets?.length && (
                <EvaluatorTestcaseModal
                    open={openTestcaseModal}
                    onCancel={() => setOpenTestcaseModal(false)}
                    testsets={testsets}
                    setSelectedTestcase={setSelectedTestcase}
                    selectedTestset={selectedTestset}
                    setSelectedTestset={setSelectedTestset}
                />
            )}
        </>
    )
}

export default DebugSection
