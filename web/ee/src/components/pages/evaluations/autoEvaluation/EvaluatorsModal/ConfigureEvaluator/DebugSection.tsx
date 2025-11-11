// @ts-nocheck
import {Dispatch, SetStateAction, useEffect, useMemo, useRef, useState} from "react"

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
import {atom, useAtomValue} from "jotai"
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
    safeParse,
    safeJson5Parse,
} from "@/oss/lib/helpers/utils"
import {getAllVariantParameters} from "@/oss/lib/helpers/variantHelper"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import {getAllMetadata} from "@/oss/lib/hooks/useStatelessVariants/state"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {getRequestSchema} from "@/oss/lib/shared/variant/openapiUtils"
import {derivePromptsFromSpec} from "@/oss/lib/shared/variant/transformer/transformer"
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
import {useAppsData} from "@/oss/state/app/hooks"
import {customPropertiesByRevisionAtomFamily} from "@/oss/state/newPlayground/core/customProperties"
import {
    stablePromptVariablesAtomFamily,
    transformedPromptsAtomFamily,
} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import EvaluatorTestcaseModal from "./EvaluatorTestcaseModal"
import EvaluatorVariantModal from "./EvaluatorVariantModal"
import {buildVariantFromRevision} from "./variantUtils"
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
        minHeight: "180px",
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
    const uriObject = useAtomValue(appUriInfoAtom)
    const appSchema = useAtomValue(appSchemaAtom)
    const {apps: availableApps = []} = useAppsData()
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

    const defaultAppId = useMemo(() => {
        if (_selectedVariant?.appId) return _selectedVariant.appId
        if (appId) return appId
        const firstApp = availableApps?.[0]
        return firstApp?.app_id ?? ""
    }, [_selectedVariant?.appId, appId, availableApps])

    const {revisionMap: defaultRevisionMap} = useAppVariantRevisions(defaultAppId || null)

    const selectedVariant = useMemo(() => {
        const revs = _selectedVariant?.revisions || []
        // find the most recent revision by looking at the updatedAtTimestamp
        const variant = revs?.sort((a, b) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
        return variant
    }, [_selectedVariant])
    const fallbackVariant = useMemo(() => {
        if (_selectedVariant || !defaultAppId) return null
        const revisionLists = Object.values(defaultRevisionMap || {})
        if (!revisionLists.length) return null
        const revisions = revisionLists[0]
        if (!revisions || revisions.length === 0) return null
        const baseVariant = buildVariantFromRevision(revisions[0], defaultAppId)
        baseVariant.revisions = [...revisions]
        return baseVariant
    }, [_selectedVariant, defaultAppId, defaultRevisionMap])

    const derivedVariants = useMemo(() => {
        if (variants && variants.length > 0) return variants
        if (fallbackVariant) return [fallbackVariant]
        return []
    }, [variants, fallbackVariant])

    useEffect(() => {
        if (_selectedVariant) return
        if (derivedVariants.length > 0) {
            setSelectedVariant(derivedVariants[0])
            return
        }
    }, [_selectedVariant, derivedVariants, setSelectedVariant])

    // Variant flags (custom/chat) from global atoms for the selected revision
    const flags = useAtomValue(
        useMemo(
            () =>
                (selectedVariant?.id
                    ? variantFlagsAtomFamily({revisionId: selectedVariant?.id})
                    : (atom(null) as any)) as any,
            [selectedVariant?.id],
        ),
    ) as any

    // Stable variables derived from saved prompts (spec + saved parameters; no live edits)
    const stableVarNames = useAtomValue(
        useMemo(
            () =>
                (selectedVariant?.id
                    ? (stablePromptVariablesAtomFamily(selectedVariant?.id) as any)
                    : (atom([]) as any)) as any,
            [selectedVariant?.id],
        ),
    ) as string[]

    // Stable parameters (prompts + custom properties derived from saved revision + schema)
    const stableTransformedParams = useAtomValue(
        useMemo(
            () =>
                (selectedVariant?.id
                    ? (transformedPromptsAtomFamily({
                          revisionId: selectedVariant?.id,
                          useStableParams: true,
                      }) as any)
                    : (atom(null) as any)) as any,
            [selectedVariant?.id],
        ),
    ) as any

    // Stable custom properties derived from spec + saved parameters (by revision)
    const customProps = useAtomValue(
        useMemo(
            () =>
                (selectedVariant?.id
                    ? (customPropertiesByRevisionAtomFamily(selectedVariant?.id) as any)
                    : (atom({}) as any)) as any,
            [selectedVariant?.id],
        ),
    ) as any

    const activeTestset = useMemo(() => {
        return testsets?.find((item) => item._id === selectedTestset)
    }, [selectedTestset, testsets])

    const isPlainObject = (value: unknown): value is Record<string, any> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value)

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

                // Normalize ground_truth and prediction to compact, comparable strings
                const normalizeCompact = (val: any) => {
                    try {
                        if (val === undefined || val === null) return ""
                        const str = typeof val === "string" ? val : JSON.stringify(val)
                        const parsed = safeJson5Parse(str)
                        if (parsed && typeof parsed === "object") {
                            return JSON.stringify(parsed)
                        }
                        return str
                    } catch {
                        return typeof val === "string" ? val : JSON.stringify(val)
                    }
                }

                const rawGT = selectedTestcase?.["testcase"]?.[groundTruthKey]
                const ground_truth = normalizeCompact(rawGT)
                const prediction = normalizeCompact(variantResult)

                outputs = {
                    ...outputs,
                    // Include all testcase fields so evaluators can access them directly (e.g., {{topic}})
                    ...selectedTestcase.testcase,
                    // Set both ground_truth and the specific correct answer key for compatibility
                    ground_truth,
                    [groundTruthKey]: ground_truth,
                    prediction,
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

            setOutputResult(getStringOrJson(runResponse.outputs))
        } catch (error: any) {
            console.error(error)
            setEvalOutputStatus({success: false, error: true})
            if (error.response.data.detail) {
                // Handle both string and object error details properly
                const errorDetail =
                    typeof error.response.data.detail === "string"
                        ? error.response.data.detail
                        : formatJson(error.response.data.detail)
                setOutputResult(getStringOrJson(errorDetail))
            } else {
                setOutputResult("Error occured")
            }
        } finally {
            setIsLoadingResult(false)
        }
    }

    const handleRunVariant = async () => {
        if (availableApps.length === 0 && derivedVariants.length === 0) {
            message.info("Create an app first to run a variant.")
            return
        }
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

            if (selectedVariant?.parameters) {
                const routePath = uriObject?.routePath || ""
                const spec = appSchema as any
                const req = spec ? (getRequestSchema as any)(spec, {routePath}) : undefined
                const hasInputsProp = Boolean(req?.properties?.inputs)
                const hasMessagesProp = Boolean(req?.properties?.messages)
                const isCustomBySchema = Boolean(spec) && !hasInputsProp && !hasMessagesProp
                const isCustom = Boolean(flags?.isCustom) || isCustomBySchema

                // Build effective input keys
                let effectiveKeys: string[] = []
                if (isCustom) {
                    // For custom workflows, use top-level schema keys
                    // Do not strip "context" here; callVariant will attach project context under root
                    // and any variable keys are handled by transformToRequestBody.
                    effectiveKeys = spec ? extractInputKeysFromSchema(spec, routePath) : []
                } else {
                    const fromParams = (() => {
                        try {
                            const p = (selectedVariant as any)?.parameters
                            const ag = p?.ag_config ?? p ?? {}
                            const s = new Set<string>()
                            Object.values(ag || {}).forEach((cfg: any) => {
                                const arr = cfg?.input_keys
                                if (Array.isArray(arr))
                                    arr.forEach((k) => typeof k === "string" && k && s.add(k))
                            })
                            return Array.from(s)
                        } catch {
                            return [] as string[]
                        }
                    })()
                    effectiveKeys = Array.from(
                        new Set([...(fromParams || []), ...(stableVarNames || [])]),
                    ).filter((k) => k && k !== "chat")
                }

                // Parameter definitions: mark as non-input so callVariant nests under inputs for non-custom
                params.inputs = (effectiveKeys || []).map((name) => ({name, input: false}))

                // Optional parameters/body extras: prefer stable transform snapshot
                const baseParameters = isPlainObject(stableTransformedParams)
                    ? {...stableTransformedParams}
                    : transformToRequestBody({
                          variant: selectedVariant,
                          allMetadata: getAllMetadata(),
                          prompts:
                              spec && selectedVariant
                                  ? derivePromptsFromSpec(
                                        selectedVariant as any,
                                        spec as any,
                                        routePath,
                                    ) || []
                                  : [],
                          // Keep request shape aligned with OpenAPI schema
                          isChat: hasMessagesProp,
                          isCustom,
                          customProperties: isCustom ? customProps : undefined,
                      })

                const variantParameters = isPlainObject(selectedVariant?.parameters)
                    ? (selectedVariant?.parameters as Record<string, any>)
                    : undefined

                if (isPlainObject(baseParameters)) {
                    const hasAgConfig =
                        isPlainObject(baseParameters.ag_config) &&
                        Object.keys(baseParameters.ag_config).length > 0

                    if (!hasAgConfig && variantParameters) {
                        const variantAgConfig = isPlainObject(variantParameters.ag_config)
                            ? variantParameters.ag_config
                            : Object.keys(variantParameters).length > 0
                              ? variantParameters
                              : undefined

                        if (variantAgConfig) {
                            baseParameters.ag_config = variantAgConfig
                        }
                    }

                    params.parameters = baseParameters
                } else if (!baseParameters && variantParameters) {
                    params.parameters = {...variantParameters}
                } else {
                    params.parameters = baseParameters
                }
                params.isChatVariant = hasMessagesProp
                params.messages = hasMessagesProp
                    ? extractChatMessages(selectedTestcase.testcase)
                    : []
                params.isCustom = isCustom
            } else {
                const {parameters, inputs} = await getAllVariantParameters(appId, selectedVariant)
                params.parameters = parameters
                params.inputs = inputs
                const hasMessagesInput = (params.inputs || []).some((p) => p.name === "messages")
                params.isChatVariant = hasMessagesInput
                params.messages = hasMessagesInput
                    ? extractChatMessages(selectedTestcase.testcase)
                    : []
                params.isCustom = selectedVariant?.isCustom
            }

            // Filter testcase down to allowed keys only (exclude chat)
            const testcaseDict = selectedTestcase.testcase
            const allowed = new Set((params.inputs || []).map((p) => p.name))
            const filtered = Object.fromEntries(
                Object.entries(testcaseDict || {}).filter(
                    ([k]) => allowed.has(k) && k !== "messages",
                ),
            )

            const result = await callVariant(
                filtered,
                params.inputs || [],
                params.parameters || [],
                appId,
                selectedVariant?.baseId,
                params.messages,
                controller.signal,
                true,
                selectedVariant?.parameters && !!selectedVariant?._parentVariant,
                params.isCustom,
                uriObject,
                selectedVariant?.variantId,
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
        <section className="flex flex-col gap-4 h-full pb-10 w-[50%]">
            <div className="flex flex-col gap-4 min-w-0">
                <Space direction="vertical" size={0}>
                    <Typography.Text className={classes.title}>Test evaluator</Typography.Text>
                    <Typography.Text type="secondary">
                        Test your evaluator by generating a test data
                    </Typography.Text>
                </Space>

                <div className="flex flex-col gap-1">
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
                                    console.error("Failed to parse testcase JSON", error)
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

                <div className="flex flex-col">
                    <div className="flex items-center justify-between">
                        <Space size={5}>
                            <Typography.Text className={classes.formTitleText}>
                                Application
                            </Typography.Text>
                            {variantStatus.success && (
                                <>
                                    <CheckCircleOutlined style={{color: "green"}} />
                                    <Typography.Text type="secondary">Success</Typography.Text>
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
                                                traceTree.trace ? getStringOrJson(traceTree) : ""
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

                <div className="flex flex-col gap-1">
                    <Flex justify="space-between">
                        <Space size={5}>
                            <Typography.Text className={classes.formTitleText}>
                                Evaluator
                            </Typography.Text>
                            {evalOutputStatus.success && (
                                <>
                                    <CheckCircleOutlined style={{color: "green"}} />
                                    <Typography.Text type="secondary">Successful</Typography.Text>
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
                                ),
                            },
                        ]}
                    />
                </div>
            </div>

            <EvaluatorVariantModal
                variants={derivedVariants}
                open={openVariantModal}
                onCancel={() => setOpenVariantModal(false)}
                setSelectedVariant={setSelectedVariant}
                selectedVariant={selectedVariant}
                selectedTestsetId={selectedTestset}
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
        </section>
    )
}

export default DebugSection
