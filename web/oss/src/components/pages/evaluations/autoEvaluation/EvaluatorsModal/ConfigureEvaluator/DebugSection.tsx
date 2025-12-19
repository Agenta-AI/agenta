// @ts-nocheck
/**
 * DebugSection - Test evaluator configuration
 *
 * This component handles testing evaluators by:
 * 1. Loading testcases from testsets
 * 2. Running a variant to generate output
 * 3. Running the evaluator on the output
 *
 * State is managed via atoms (see ./state/atoms.ts):
 * - playgroundSelectedTestcaseAtom: Selected testcase data
 * - playgroundSelectedVariantAtom: Selected variant for testing
 * - playgroundSelectedTestsetIdAtom: Selected testset ID
 * - playgroundTraceTreeAtom: Trace output from running variant
 * - playgroundEvaluatorAtom: Current evaluator being configured
 * - playgroundFormRefAtom: Form instance for reading settings
 */
import {useEffect, useMemo, useRef, useState} from "react"

import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    MoreOutlined,
} from "@ant-design/icons"
import {Database, Lightning, Play} from "@phosphor-icons/react"
import {Button, Dropdown, Flex, Space, Tabs, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"
import {createUseStyles} from "react-jss"

import {message} from "@/oss/components/AppMessageContext"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {useAppId} from "@/oss/hooks/useAppId"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {transformTraceKeysInSettings, mapTestcaseAndEvalValues} from "@/oss/lib/evaluations/legacy"
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
import {buildNodeTree, observabilityTransformer} from "@/oss/lib/traces/observability_helpers"
import {
    buildNodeTreeV3,
    fromBaseResponseToTraceSpanType,
    transformTraceTreeToJson,
} from "@/oss/lib/transformers"
import {
    BaseResponse,
    ChatMessage,
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
import {
    playgroundEvaluatorAtom,
    playgroundFormRefAtom,
    playgroundSelectedTestcaseAtom,
    playgroundSelectedTestsetIdAtom,
    playgroundSelectedVariantAtom,
    playgroundTraceTreeAtom,
} from "./state/atoms"
import {buildVariantFromRevision} from "./variantUtils"

/**
 * Props for DebugSection
 *
 * Most state is now managed via atoms (see ./state/atoms.ts).
 * These props are for data that comes from queries (variants, testsets).
 */
interface DebugSectionProps {
    /** Available testsets for loading testcases (from query) */
    testsets: testset[] | null
    /** Available variants for running (from query) */
    variants: Variant[] | null
    /** Whether debug mode is enabled */
    debugEvaluator?: boolean
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    "@global": {
        /* Make selection modal fit viewport/container with scrollable body */
        ".ant-modal .ant-modal-content": {
            maxHeight: "80vh",
            display: "flex",
            flexDirection: "column",
        },
        ".ant-modal .ant-modal-body": {
            overflow: "auto",
        },
    },
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
        minHeight: "180px",
        height: "100%",
        maxHeight: 200,
        overflow: "auto",
        "&.agenta-shared-editor": {
            borderColor: theme.colorBorder,
            borderRadius: theme.borderRadius,
        },
        "& .agenta-editor-wrapper": {
            minHeight: "180px",
            height: "100%",
        },
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

const LAST_APP_KEY = "agenta:lastAppId"
const LAST_VARIANT_KEY = "agenta:lastVariantId"

const DebugSection = ({testsets, variants, debugEvaluator = true}: DebugSectionProps) => {
    const appId = useAppId()
    const classes = useStyles()
    const uriObject = useAtomValue(appUriInfoAtom)
    const appSchema = useAtomValue(appSchemaAtom)
    const {apps: availableApps = []} = useAppsData()

    // ================================================================
    // ATOMS - Read/write state from playground atoms
    // ================================================================
    const selectedTestcase = useAtomValue(playgroundSelectedTestcaseAtom)
    const setSelectedTestcase = useSetAtom(playgroundSelectedTestcaseAtom)
    const _selectedVariant = useAtomValue(playgroundSelectedVariantAtom)
    const setSelectedVariant = useSetAtom(playgroundSelectedVariantAtom)
    const selectedTestset = useAtomValue(playgroundSelectedTestsetIdAtom)
    const setSelectedTestset = useSetAtom(playgroundSelectedTestsetIdAtom)
    const traceTree = useAtomValue(playgroundTraceTreeAtom)
    const setTraceTree = useSetAtom(playgroundTraceTreeAtom)
    const selectedEvaluator = useAtomValue(playgroundEvaluatorAtom)
    const form = useAtomValue(playgroundFormRefAtom)

    // DEBUG: Log atom states
    console.log("[DebugSection] Atom states:", {
        _selectedVariant: _selectedVariant,
        _selectedVariantId: (_selectedVariant as any)?.variantId,
        _selectedVariantRevisions: (_selectedVariant as any)?.revisions?.length,
        selectedTestcase: selectedTestcase,
        selectedTestset: selectedTestset,
        selectedEvaluator: selectedEvaluator?.key,
        formExists: !!form,
    })
    const [baseResponseData, setBaseResponseData] = useState<BaseResponse | null>(null)
    const [outputResult, setOutputResult] = useState("")
    const [isLoadingResult, setIsLoadingResult] = useState(false)
    const abortControllersRef = useRef<AbortController | null>(null)
    const [isRunningVariant, setIsRunningVariant] = useState(false)
    const [variantResult, setVariantResult] = useState("")
    const [openVariantModal, setOpenVariantModal] = useState(false)
    const [openTestcaseModal, setOpenTestcaseModal] = useState(false)

    // DEBUG: Log modal state changes
    useEffect(() => {
        console.log("[DebugSection] openVariantModal changed:", openVariantModal)
    }, [openVariantModal])
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
        console.log("[DebugSection] Computing selectedVariant from _selectedVariant:", {
            _selectedVariant,
            hasRevisions: !!((_selectedVariant as any)?.revisions?.length),
        })
        if (!_selectedVariant) return undefined
        // If the variant has revisions, get the most recent one
        const revs = (_selectedVariant as any)?.revisions || []
        if (revs.length > 0) {
            const result = revs.sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
            console.log("[DebugSection] selectedVariant (from revisions):", result)
            return result
        }
        // Otherwise, return the variant itself (it may already be a revision or simple variant)
        console.log("[DebugSection] selectedVariant (direct):", _selectedVariant)
        return _selectedVariant
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

    // Resolve current application object for display
    const selectedApp = useMemo(() => {
        const id = _selectedVariant?.appId || defaultAppId
        return availableApps.find((a: any) => a.app_id === id)
    }, [_selectedVariant?.appId, defaultAppId, availableApps])

    // Initialize from localStorage (remember last app/variant) with fallbacks
    useEffect(() => {
        // if parent already set a specific variant, respect it
        if (_selectedVariant) return

        const storedAppId =
            typeof window !== "undefined" ? localStorage.getItem(LAST_APP_KEY) : null
        const storedVariantId =
            typeof window !== "undefined" ? localStorage.getItem(LAST_VARIANT_KEY) : null

        let nextVariant: Variant | null = null

        // 1) Try to find an existing variant matching stored ids among provided or fallback variants
        const searchPool: Variant[] = [...(variants || []), ...(derivedVariants || [])].filter(
            Boolean,
        ) as Variant[]

        if (storedVariantId) {
            nextVariant = searchPool.find((v) => (v as any)?.variantId === storedVariantId) || null
        }

        // 2) If not found by variant, but we have an app id, try first variant under that app
        if (!nextVariant && storedAppId) {
            nextVariant = searchPool.find((v) => (v as any)?.appId === storedAppId) || null
        }

        // 3) Finally fall back to first available variant in our computed list
        if (!nextVariant && searchPool.length > 0) {
            nextVariant = searchPool[0]
        }

        if (nextVariant) {
            setSelectedVariant(nextVariant)
        }
    }, [_selectedVariant, variants, derivedVariants, setSelectedVariant])

    // Persist whenever the working selectedVariant changes
    useEffect(() => {
        const v = _selectedVariant as any
        if (!v) return
        try {
            if (v.appId) localStorage.setItem(LAST_APP_KEY, v.appId)
            if (v.variantId) localStorage.setItem(LAST_VARIANT_KEY, v.variantId)
        } catch {
            // ignore storage errors (private mode, etc.)
        }
    }, [_selectedVariant])

    useEffect(() => {
        if (_selectedVariant) return
        if (derivedVariants.length > 0) {
            setSelectedVariant(derivedVariants[0])
            return
        }
    }, [_selectedVariant, derivedVariants, setSelectedVariant])

    // Initialize testset selection when testsets are available
    useEffect(() => {
        if (selectedTestset) return // Already have a selection
        if (testsets?.length) {
            setSelectedTestset(testsets[0]._id)
        }
    }, [testsets, selectedTestset, setSelectedTestset])

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
        if (!baseResponseData || !selectedTestcase.testcase || !selectedEvaluator || !form) return

        try {
            setEvalOutputStatus({success: false, error: false})
            setIsLoadingResult(true)

            const settingsValues = form.getFieldValue("settings_values") || {}
            let normalizedSettings = {...settingsValues}

            if (typeof normalizedSettings.json_schema === "string") {
                try {
                    const parsed = JSON.parse(normalizedSettings.json_schema)
                    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                        throw new Error()
                    }
                    normalizedSettings.json_schema = parsed
                } catch {
                    message.error("JSON schema must be a valid JSON object")
                    setEvalOutputStatus({success: false, error: true})
                    setIsLoadingResult(false)
                    return
                }
            } else if (
                normalizedSettings.json_schema &&
                (typeof normalizedSettings.json_schema !== "object" ||
                    Array.isArray(normalizedSettings.json_schema))
            ) {
                message.error("JSON schema must be a valid JSON object")
                setEvalOutputStatus({success: false, error: true})
                setIsLoadingResult(false)
                return
            }

            const {testcaseObj, evalMapObj} = mapTestcaseAndEvalValues(
                normalizedSettings,
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
                    ...selectedTestcase.testcase,
                    ground_truth,
                    [groundTruthKey]: ground_truth,
                    prediction,
                    ...(selectedEvaluator.key === "auto_custom_code_run" ? {app_config: {}} : {}),
                }
            }

            const runResponse = await createEvaluatorRunExecution(selectedEvaluator.key, {
                inputs: outputs,
                settings: transformTraceKeysInSettings(normalizedSettings),
                ...(selectedEvaluator.requires_llm_api_keys || settingsValues?.requires_llm_api_keys
                    ? {credentials: apiKeyObject(secrets)}
                    : {}),
            })
            setEvalOutputStatus({success: true, error: false})

            setOutputResult(getStringOrJson(runResponse.outputs))
        } catch (error: any) {
            console.error(error)
            setEvalOutputStatus({success: false, error: true})
            if (error.response?.data?.detail) {
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
        console.log("[DebugSection] handleRunVariant called", {
            availableAppsLength: availableApps.length,
            derivedVariantsLength: derivedVariants.length,
            selectedTestcase: selectedTestcase,
            selectedVariant: selectedVariant,
            selectedVariantId: selectedVariant?.variantId,
        })
        if (availableApps.length === 0 && derivedVariants.length === 0) {
            console.log("[DebugSection] No apps or variants available")
            message.info("Create an app first to run a variant.")
            return
        }
        if (!selectedTestcase.testcase || !selectedVariant) {
            console.log("[DebugSection] Missing testcase or variant", {
                hasTestcase: !!selectedTestcase.testcase,
                hasVariant: !!selectedVariant,
            })
            return
        }
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

            // Only use schema/uri when they belong to the same app as the selected variant
            const selectedAppId = (selectedVariant as any)?.appId
            const uriAppId = (uriObject as any)?.appId || (uriObject as any)?.app_id
            const isSameAppAsUri = selectedAppId && uriAppId && selectedAppId === uriAppId

            const safeSpec: any | undefined = isSameAppAsUri ? appSchema : undefined
            const safeRoutePath: string = isSameAppAsUri ? uriObject?.routePath || "" : ""
            const safeUriObject = isSameAppAsUri ? uriObject : undefined

            if (selectedVariant?.parameters) {
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

                let effectiveKeys: string[] = Array.from(
                    new Set([...(fromParams || []), ...(stableVarNames || [])]),
                ).filter((k) => k && k !== "chat")

                let hasInputsProp = false
                let hasMessagesPropFromSchema = false
                if (safeSpec) {
                    const req = (getRequestSchema as any)(safeSpec, {routePath: safeRoutePath})
                    hasInputsProp = Boolean(req?.properties?.inputs)
                    hasMessagesPropFromSchema = Boolean(req?.properties?.messages)
                }

                const isCustomFromFlag = Boolean(
                    flags?.isCustom ?? (selectedVariant as any)?.isCustom,
                )
                const isCustomBySchema = safeSpec
                    ? Boolean(safeSpec) && !hasInputsProp && !hasMessagesPropFromSchema
                    : false
                const isCustom = isCustomFromFlag || isCustomBySchema

                if (isCustom && safeSpec) {
                    const schemaKeys = extractInputKeysFromSchema(safeSpec, safeRoutePath) || []
                    effectiveKeys = Array.from(new Set([...(effectiveKeys || []), ...schemaKeys]))
                }

                const isChatBySchema = safeSpec ? hasMessagesPropFromSchema : null
                const isChatByKeys = (effectiveKeys || []).includes("messages")
                const isChat = isChatBySchema !== null ? isChatBySchema : isChatByKeys

                params.inputs = (effectiveKeys || []).map((name) => ({name, input: false}))

                const baseParameters = isPlainObject(stableTransformedParams)
                    ? {...stableTransformedParams}
                    : transformToRequestBody({
                          variant: selectedVariant,
                          allMetadata: getAllMetadata(),
                          prompts:
                              safeSpec && selectedVariant
                                  ? derivePromptsFromSpec(
                                        selectedVariant as any,
                                        safeSpec as any,
                                        safeRoutePath,
                                    ) || []
                                  : [],
                          isChat,
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
                            ;(baseParameters as any).ag_config = variantAgConfig
                        }
                    }

                    params.parameters = baseParameters
                } else if (!baseParameters && variantParameters) {
                    params.parameters = {...variantParameters}
                } else {
                    params.parameters = baseParameters
                }

                let messagesFromTestcase = extractChatMessages(selectedTestcase.testcase)
                let messagesFromParams = Array.isArray((params.parameters as any)?.messages)
                    ? (params.parameters as any).messages
                    : undefined

                if (isChat) {
                    const finalMessages =
                        messagesFromTestcase && messagesFromTestcase.length > 0
                            ? messagesFromTestcase
                            : messagesFromParams && messagesFromParams.length > 0
                              ? messagesFromParams
                              : []

                    if (finalMessages.length === 0) {
                        setIsRunningVariant(false)
                        message.error(
                            "This application requires chat 'messages', but none were provided or generated. Add messages to your testcase or prompt template.",
                        )
                        return
                    }

                    params.messages = finalMessages
                } else {
                    params.messages = []
                }

                params.isChatVariant = isChat
                params.isCustom = isCustom
            } else {
                const {parameters, inputs} = await getAllVariantParameters(appId, selectedVariant)
                params.parameters = parameters
                params.inputs = inputs
                const hasMessagesInput = (inputs || []).some((p) => p.name === "messages")
                params.isChatVariant = hasMessagesInput
                params.messages = hasMessagesInput
                    ? extractChatMessages(selectedTestcase.testcase)
                    : []
                params.isCustom = selectedVariant?.isCustom
                if (hasMessagesInput && params.messages.length === 0) {
                    setIsRunningVariant(false)
                    message.error(
                        "This application requires chat 'messages', but none were provided. Add messages to your testcase.",
                    )
                    return
                }
            }

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
                safeUriObject, // <<< ensure we don't pass a foreign URI
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

                if (trace?.spans) {
                    setTraceTree({
                        trace: transformTraceTreeToJson(
                            fromBaseResponseToTraceSpanType(trace.spans, trace.trace_id)[0],
                        ),
                    })
                }

                if (tree) {
                    const tTree = tree.nodes
                        .flatMap((node: AgentaNodeDTO) => buildNodeTree(node))
                        .flatMap((item: any) => observabilityTransformer(item))
                        .map((item) => {
                            const {key, children, ...trace} = item
                            return trace
                        })[0]

                    setTraceTree({
                        trace: buildNodeTreeV3(tTree),
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
                if (error.response?.data?.detail) {
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

    const testcaseEditorKey = useMemo(
        () => `testcase-${selectedTestset}-${JSON.stringify(selectedTestcase.testcase ?? {})}`,
        [selectedTestset, selectedTestcase.testcase],
    )

    const _variantOutputEditorKey = useMemo(
        () =>
            `variant-output-${selectedVariant?.variantId ?? "none"}-${JSON.stringify(
                selectedTestcase.testcase ?? {},
            )}`,
        [selectedVariant?.variantId, selectedTestcase.testcase],
    )

    const _traceEditorKey = useMemo(
        () =>
            `trace-${selectedVariant?.variantId ?? "none"}-${JSON.stringify(
                traceTree.trace ?? {},
            )}`,
        [selectedVariant?.variantId, traceTree.trace],
    )

    const _evaluatorOutputEditorKey = useMemo(
        () =>
            `evaluator-output-${selectedEvaluator?.key ?? "none"}-${JSON.stringify(
                selectedTestcase.testcase ?? {},
            )}`,
        [selectedEvaluator?.key, selectedTestcase.testcase],
    )

    // Helper to print "App / Variant" nicely
    const appName = selectedApp?.name || selectedApp?.app_name || "app"
    const variantName = selectedVariant?.variantName || "variant"

    // Guard: if no evaluator selected, show nothing (shouldn't happen in normal flow)
    if (!selectedEvaluator) {
        return null
    }

    return (
        <section className="flex flex-col gap-4 h-full pb-10 w-full">
            <div className="flex flex-col gap-4 min-w-0">
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
                        <SharedEditor
                            key={testcaseEditorKey}
                            className={`${classes.editor} h-full`}
                            editorType="border"
                            initialValue={getStringOrJson(
                                selectedTestcase.testcase ? formatJson(selectedTestcase.testcase) : "",
                            )}
                            handleChange={(value) => {
                                try {
                                    if (value) {
                                        const parsedValue = JSON.parse(value)
                                        setSelectedTestcase({testcase: parsedValue})
                                    }
                                } catch (error) {
                                    console.error("Failed to parse testcase JSON", error)
                                }
                            }}
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showLineNumbers: false,
                            }}
                            syncWithInitialValueChanges={true}
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
                                onClick={() => {
                                    console.log("[DebugSection] Run button clicked")
                                    handleRunVariant()
                                }}
                                loading={isRunningVariant}
                                icon={<MoreOutlined />}
                                menu={{
                                    items: [
                                        {
                                            key: "change_variant",
                                            icon: <Lightning />,
                                            label: "Change application",
                                            onClick: () => {
                                                console.log("[DebugSection] Change application clicked, opening modal")
                                                setOpenVariantModal(true)
                                            },
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
                                    {/* Show "App / Variant" */}
                                    Run application ({appName}/{variantName})
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
                                        <SharedEditor
                                            key={`debug-output-${variantResult}`}
                                            className={`${classes.editor} h-full`}
                                            editorClassName={clsx([
                                                "!border-none !shadow-none px-0 overflow-hidden",
                                            ])}
                                            editorType="border"
                                            useAntdInput
                                            antdInputProps={{
                                                textarea: true,
                                                autoSize: {minRows: 10, maxRows: 10},
                                            }}
                                            initialValue={variantResult}
                                            handleChange={(value) => {
                                                if (value) {
                                                    setVariantResult(value)
                                                }
                                            }}
                                            syncWithInitialValueChanges={true}
                                        />
                                    </div>
                                ),
                            },
                            {
                                key: "trace",
                                label: "Trace",
                                children: (
                                    <div className="w-full h-full overflow-hidden">
                                        <SharedEditor
                                            key={`debug-trace-${traceTree?.trace}`}
                                            className={`${classes.editor} h-full`}
                                            editorType="border"
                                            initialValue={
                                                traceTree.trace ? getStringOrJson(traceTree) : ""
                                            }
                                            handleChange={(value) => {
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
                                            editorProps={{
                                                codeOnly: true,
                                                language: "json",
                                                showLineNumbers: false,
                                            }}
                                            syncWithInitialValueChanges={true}
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
                                        <SharedEditor
                                            key={`debug-output-${variantResult}`}
                                            className={`${classes.editor} h-full`}
                                            readOnly
                                            disabled
                                            state="disabled"
                                            editorType="border"
                                            initialValue={formatOutput(outputResult)}
                                            editorProps={{
                                                codeOnly: true,
                                                language: "yaml",
                                                readOnly: true,
                                                disabled: true,
                                                showLineNumbers: false,
                                            }}
                                            syncWithInitialValueChanges={true}
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
                onCancel={() => {
                    console.log("[DebugSection] Modal cancelled")
                    setOpenVariantModal(false)
                }}
                setSelectedVariant={(v) => {
                    console.log("[DebugSection] setSelectedVariant from modal:", {
                        variant: v,
                        variantId: (v as any)?.variantId,
                        revisions: (v as any)?.revisions?.length,
                    })
                    setSelectedVariant(v)
                    // eager persist on selection from modal
                    try {
                        if ((v as any)?.appId) localStorage.setItem(LAST_APP_KEY, (v as any).appId)
                        if ((v as any)?.variantId)
                            localStorage.setItem(LAST_VARIANT_KEY, (v as any).variantId)
                    } catch {}
                }}
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
