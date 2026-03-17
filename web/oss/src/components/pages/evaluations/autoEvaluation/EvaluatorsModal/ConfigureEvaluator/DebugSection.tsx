/**
 * State is managed via atoms (see ./state/atoms.ts):
 * - playgroundSelectedTestcaseAtom: Selected testcase data
 * - playgroundSelectedVariantAtom: Selected variant for testing
 * - playgroundSelectedTestsetIdAtom: Selected testset ID
 * - playgroundTraceTreeAtom: Trace output from running variant
 * - playgroundEvaluatorAtom: Current evaluator being configured
 * - playgroundFormRefAtom: Form instance for reading settings
 *
 * Data fetching:
 * - Variants: fetched internally via workflowRevisionsByWorkflowListDataAtomFamily()
 * - Apps: fetched internally via useAppsData()
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {transformToRequestBody} from "@agenta/entities/shared/execution"
import {
    extractAllEndpointSchemas,
    extractInputKeysFromSchema,
} from "@agenta/entities/shared/openapi"
import {
    workflowMolecule,
    workflowRevisionsByWorkflowListDataAtomFamily,
} from "@agenta/entities/workflow"
import {
    appOpenApiSchemaAtomFamily,
    appRoutePathAtomFamily,
    requestPayloadAtomFamily,
} from "@agenta/entities/workflow"
import {uuidToSpanId, uuidToTraceId} from "@agenta/shared/utils"
import {safeJson5Parse} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {
    CheckCircleOutlined,
    CloseCircleOutlined,
    ExclamationCircleOutlined,
    MoreOutlined,
} from "@ant-design/icons"
import {Database, Lightning, Play} from "@phosphor-icons/react"
import {Button, Dropdown, Flex, Space, Tabs, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import type {LoadTestsetSelectionPayload} from "@/oss/components/Playground/Components/Modals/LoadTestsetModal/assets/types"
import {useAppId} from "@/oss/hooks/useAppId"
import {transformTraceKeysInSettings, mapTestcaseAndEvalValues} from "@/oss/lib/evaluations/legacy"
import {buildEvaluatorUri, resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {isBaseResponse, isFuncResponse} from "@/oss/lib/helpers/playgroundResp"
import {extractChatMessages, getStringOrJson, safeParse} from "@/oss/lib/helpers/utils"
import {getAllVariantParameters} from "@/oss/lib/helpers/variantHelper"
import {buildNodeTree, observabilityTransformer} from "@/oss/lib/traces/observability_helpers"
import {
    buildNodeTreeV3,
    fromBaseResponseToTraceSpanType,
    transformTraceTreeToJson,
} from "@/oss/lib/transformers"
import {BaseResponse, ChatMessage, JSSTheme, Parameter, Variant} from "@/oss/lib/Types"
import {callVariant} from "@/oss/services/api"
import {AgentaNodeDTO} from "@/oss/services/observability/types"
import {
    invokeApplication,
    invokeEvaluator,
    mapWorkflowResponseToOutputs,
    mapWorkflowResponseToEvaluatorOutput,
    type WorkflowServiceBatchResponse,
    type WorkflowServiceLink,
    type WorkflowServiceReference,
} from "@/oss/services/workflows/invoke"
import {useAppsData} from "@/oss/state/app/hooks"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {revision} from "@/oss/state/entities/testset"

import EvaluatorVariantModal from "./EvaluatorVariantModal"
import {
    playgroundEvaluatorAtom,
    playgroundEditValuesAtom,
    playgroundFormRefAtom,
    playgroundLastAppIdAtom,
    playgroundLastVariantIdAtom,
    playgroundSelectedTestcaseAtom,
    playgroundSelectedRevisionIdAtom,
    playgroundSelectedVariantAtom,
    playgroundTraceTreeAtom,
} from "./state/atoms"
import {buildVariantFromRevision} from "./variantUtils"

/**
 * DebugSection has no required props - it fetches all data internally
 * and reads state from atoms.
 */

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
        minWidth: 0,
        "& .ant-tabs-content-holder": {
            minHeight: 0,
        },
    },
}))

const LoadTestsetModal = dynamic(
    () => import("@/oss/components/Playground/Components/Modals/LoadTestsetModal"),
    {ssr: false},
)

const normalizeTraceId = (value?: string | null) => {
    if (!value) return undefined
    if (!value.includes("-")) return value

    try {
        return uuidToTraceId(value)
    } catch {
        return undefined
    }
}

const normalizeSpanId = (value?: string | null) => {
    if (!value) return undefined
    if (value.includes("-")) {
        try {
            return uuidToSpanId(value)
        } catch {
            return undefined
        }
    }
    return value.length === 32 ? value.slice(-16) : value
}

const toWorkflowLink = ({
    traceId,
    spanId,
}: {
    traceId?: string | null
    spanId?: string | null
}): WorkflowServiceLink | undefined => {
    const normalizedTraceId = normalizeTraceId(traceId)
    const normalizedSpanId = normalizeSpanId(spanId)

    if (!normalizedTraceId || !normalizedSpanId) return undefined

    return {
        trace_id: normalizedTraceId,
        span_id: normalizedSpanId,
    }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

const readString = (value: unknown) => {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

const normalizeApplicationReferences = (
    references: unknown,
): Record<string, WorkflowServiceReference> | undefined => {
    const refs = asRecord(references)
    if (!refs) return undefined

    const appRef = asRecord(refs.application)
    const appVariantRef = asRecord(refs.application_variant)
    const appRevisionRef = asRecord(refs.application_revision)
    const normalized: Record<string, WorkflowServiceReference> = {}

    const applicationId = readString(appRef?.id)
    const applicationSlug = readString(appRef?.slug)
    if (applicationId || applicationSlug) {
        normalized.application = {
            ...(applicationId ? {id: applicationId} : {}),
            ...(applicationSlug ? {slug: applicationSlug} : {}),
        }
    }

    const applicationVariantId = readString(appVariantRef?.id) || readString(appRef?.variant_id)
    const applicationVariantSlug = readString(appVariantRef?.slug)
    if (applicationVariantId || applicationVariantSlug) {
        normalized.application_variant = {
            ...(applicationVariantId ? {id: applicationVariantId} : {}),
            ...(applicationVariantSlug ? {slug: applicationVariantSlug} : {}),
        }
    }

    const applicationRevisionId = readString(appRevisionRef?.id) || readString(appRef?.revision_id)
    const applicationRevisionSlug = readString(appRevisionRef?.slug)
    const applicationRevisionVersion = readString(appRevisionRef?.version)
    if (applicationRevisionId || applicationRevisionSlug || applicationRevisionVersion) {
        normalized.application_revision = {
            ...(applicationRevisionId ? {id: applicationRevisionId} : {}),
            ...(applicationRevisionSlug ? {slug: applicationRevisionSlug} : {}),
            ...(applicationRevisionVersion ? {version: applicationRevisionVersion} : {}),
        }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined
}

const extractRootSpanId = (spans?: {id?: string; parent_span_id?: string | null}[]) => {
    if (!Array.isArray(spans) || spans.length === 0) return undefined
    return spans.find((span) => !span.parent_span_id)?.id || spans[0]?.id
}

const extractLinkFromWorkflowResponse = (response?: WorkflowServiceBatchResponse | null) =>
    toWorkflowLink({
        traceId: response?.trace_id,
        spanId: response?.span_id,
    })

const extractLinkFromBaseResponse = (response?: BaseResponse | null) =>
    toWorkflowLink({
        traceId: response?.trace?.trace_id || response?.tree?.nodes?.[0]?.root?.id,
        spanId: extractRootSpanId(response?.trace?.spans) || response?.tree?.nodes?.[0]?.node?.id,
    })

const DebugSection = () => {
    const appId = useAppId()
    const classes = useStyles()
    const {apps: availableApps = []} = useAppsData()

    // ================================================================
    // ATOMS - Read/write state from playground atoms
    // ================================================================
    const selectedTestcase = useAtomValue(playgroundSelectedTestcaseAtom)
    const setSelectedTestcase = useSetAtom(playgroundSelectedTestcaseAtom)
    const _selectedVariant = useAtomValue(playgroundSelectedVariantAtom)
    const setSelectedVariant = useSetAtom(playgroundSelectedVariantAtom)
    const selectedRevisionId = useAtomValue(playgroundSelectedRevisionIdAtom)
    const setSelectedRevisionId = useSetAtom(playgroundSelectedRevisionIdAtom)
    const traceTree = useAtomValue(playgroundTraceTreeAtom)
    const setTraceTree = useSetAtom(playgroundTraceTreeAtom)
    const selectedEvaluator = useAtomValue(playgroundEvaluatorAtom)
    const evaluatorConfig = useAtomValue(playgroundEditValuesAtom)
    const form = useAtomValue(playgroundFormRefAtom)
    const [lastAppId, setLastAppId] = useAtom(playgroundLastAppIdAtom)
    const [lastVariantId, setLastVariantId] = useAtom(playgroundLastVariantIdAtom)

    const [baseResponseData, setBaseResponseData] = useState<BaseResponse | null>(null)
    const [lastInvocationLink, setLastInvocationLink] = useState<WorkflowServiceLink | null>(null)
    const [outputResult, setOutputResult] = useState("")
    const [isLoadingResult, setIsLoadingResult] = useState(false)
    const abortControllersRef = useRef<AbortController | null>(null)
    const evaluatorAbortRef = useRef<AbortController | null>(null)
    const [isRunningVariant, setIsRunningVariant] = useState(false)
    const [variantResult, setVariantResult] = useState("")
    const [openVariantModal, setOpenVariantModal] = useState(false)
    const [openTestcaseModal, setOpenTestcaseModal] = useState(false)
    const [dropdownOpen, setDropdownOpen] = useState(false)

    const [variantStatus, setVariantStatus] = useState({
        success: false,
        error: false,
    })
    const [evalOutputStatus, setEvalOutputStatus] = useState({
        success: false,
        error: false,
    })

    const handleEvaluatorTestsetData = useCallback(
        (payload: LoadTestsetSelectionPayload | null) => {
            const testcase = payload?.testcases?.[0]
            if (!testcase) {
                setSelectedRevisionId("")
                setSelectedTestcase({testcase: null})
                return
            }

            if (payload?.revisionId) {
                setSelectedRevisionId(payload.revisionId)
            }

            const sanitized =
                typeof testcase === "object"
                    ? Object.fromEntries(
                          Object.entries(testcase).filter(([key]) => !key.startsWith("__")),
                      )
                    : testcase

            setSelectedTestcase({testcase: sanitized || null})
        },
        [setSelectedRevisionId, setSelectedTestcase],
    )

    const defaultAppId = useMemo(() => {
        if (_selectedVariant?.appId) return _selectedVariant.appId
        if (appId) return appId
        // Check persisted last used app
        if (lastAppId && availableApps?.some((a: any) => a.id === lastAppId)) {
            return lastAppId
        }
        const firstApp = availableApps?.[0]
        return firstApp?.id ?? ""
    }, [_selectedVariant?.appId, appId, availableApps, lastAppId])

    const allRevisions = useAtomValue(
        useMemo(
            () => workflowRevisionsByWorkflowListDataAtomFamily(defaultAppId || ""),
            [defaultAppId],
        ),
    )

    const defaultRevisionMap = useMemo(() => {
        return (allRevisions ?? []).reduce<Record<string, typeof allRevisions>>((acc, revision) => {
            const key = (revision as any).workflow_variant_id || (revision as any).variant_id || ""
            if (!acc[key]) acc[key] = []
            acc[key].push(revision)
            return acc
        }, {})
    }, [allRevisions])

    const selectedVariant = useMemo(() => {
        if (!_selectedVariant) return undefined
        // If the variant has revisions, get the most recent one
        const revs = (_selectedVariant as any)?.revisions || []
        if (revs.length > 0) {
            return revs.sort((a: any, b: any) => b.updatedAtTimestamp - a.updatedAtTimestamp)[0]
        }
        // Otherwise, return the variant itself (it may already be a revision or simple variant)
        return _selectedVariant
    }, [_selectedVariant])

    // Build ALL variants from the app for localStorage restore and fallback selection
    const derivedVariants = useMemo(() => {
        if (_selectedVariant) return [] // Don't need fallbacks if already selected
        if (!defaultAppId || !Object.keys(defaultRevisionMap).length) return []

        const variants: Variant[] = []
        Object.values(defaultRevisionMap).forEach((revisions) => {
            if (!revisions || revisions.length === 0) return
            const baseVariant = buildVariantFromRevision(revisions[0] as any, defaultAppId)
            baseVariant.revisions = [...revisions] as any
            variants.push(baseVariant)
        })
        return variants
    }, [_selectedVariant, defaultAppId, defaultRevisionMap])

    // Resolve current application object for display
    const selectedApp = useMemo(() => {
        const id = _selectedVariant?.appId || defaultAppId
        return availableApps.find((a: any) => a.id === id)
    }, [_selectedVariant?.appId, defaultAppId, availableApps])

    // Initialize from persisted state (remember last app/variant) with fallbacks
    useEffect(() => {
        // if already have a selected variant, respect it
        if (_selectedVariant) return

        let nextVariant: Variant | null = null

        // Search among derived variants (fetched internally)
        const searchPool: Variant[] = derivedVariants.filter(Boolean) as Variant[]

        if (lastVariantId) {
            nextVariant = searchPool.find((v) => (v as any)?.variantId === lastVariantId) || null
        }

        // If not found by variant, but we have an app id, try first variant under that app
        if (!nextVariant && lastAppId) {
            nextVariant = searchPool.find((v) => (v as any)?.appId === lastAppId) || null
        }

        // Fall back to first available variant
        if (!nextVariant && searchPool.length > 0) {
            nextVariant = searchPool[0]
        }

        if (nextVariant) {
            setSelectedVariant(nextVariant)
        }
    }, [_selectedVariant, derivedVariants, setSelectedVariant, lastAppId, lastVariantId])

    // Persist whenever the working selectedVariant changes
    useEffect(() => {
        const v = _selectedVariant as any
        if (!v) return
        if (v.appId) setLastAppId(v.appId)
        if (v.variantId) setLastVariantId(v.variantId)
    }, [_selectedVariant, setLastAppId, setLastVariantId])

    // No manual molecule seeding needed — workflowMolecule auto-fetches by ID

    // App context for custom/chat flags
    const appContext = useAtomValue(currentAppContextAtom)
    const isCustomFlag = appContext?.appType === "custom"

    // Per-revision schema from workflow molecule
    const revisionSchema = useAtomValue(
        useMemo(
            () =>
                selectedVariant?.id
                    ? appOpenApiSchemaAtomFamily(selectedVariant.id)
                    : (atom(null) as any),
            [selectedVariant?.id],
        ),
    ) as any
    const revisionRoutePath = useAtomValue(
        useMemo(
            () =>
                selectedVariant?.id
                    ? appRoutePathAtomFamily(selectedVariant.id)
                    : (atom("") as any),
            [selectedVariant?.id],
        ),
    ) as string

    // Stable variables derived from workflow input schema
    const inputSchema = useAtomValue(
        useMemo(
            () =>
                selectedVariant?.id
                    ? workflowMolecule.selectors.inputSchema(selectedVariant.id)
                    : atom<Record<string, unknown> | null>(null),
            [selectedVariant?.id],
        ),
    )
    const stableVarNames = useMemo(() => {
        if (!inputSchema || typeof inputSchema !== "object") return []
        const properties = (inputSchema as Record<string, unknown>).properties
        if (!properties || typeof properties !== "object") return []
        return Object.keys(properties as Record<string, unknown>).filter((k) => k.length > 0)
    }, [inputSchema])

    // Read raw entity data for variant parameters
    const variantEntityData = useAtomValue(
        useMemo(
            () =>
                selectedVariant?.id
                    ? workflowMolecule.selectors.data(selectedVariant.id)
                    : (atom(null) as any),
            [selectedVariant?.id],
        ),
    ) as any

    const revisionRequestPayload = useAtomValue(
        useMemo(
            () =>
                selectedVariant?.id
                    ? requestPayloadAtomFamily(selectedVariant.id)
                    : (atom(null) as any),
            [selectedVariant?.id],
        ),
    ) as any
    const applicationReferences = useMemo(
        () => normalizeApplicationReferences(revisionRequestPayload?.references),
        [revisionRequestPayload?.references],
    )

    const activeRevision = useAtomValue(
        useMemo(
            () =>
                (selectedRevisionId
                    ? (revision.selectors.data(selectedRevisionId) as any)
                    : (atom(null) as any)) as any,
            [selectedRevisionId],
        ),
    ) as any

    const activeTestsetLabel = useMemo(() => {
        if (!activeRevision) return null
        const version =
            typeof activeRevision.version === "number"
                ? activeRevision.version
                : parseInt(activeRevision.version || "0", 10)
        return {
            name: activeRevision.name || activeRevision.testset_id || null,
            version: Number.isFinite(version) ? version : null,
        }
    }, [activeRevision])

    const isPlainObject = (value: unknown): value is Record<string, any> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value)

    const fetchEvalMapper = async () => {
        if (!baseResponseData || !selectedTestcase.testcase || !selectedEvaluator || !form) return

        const controller = new AbortController()
        evaluatorAbortRef.current = controller

        try {
            setEvalOutputStatus({success: false, error: false})
            setIsLoadingResult(true)

            const parameters = form.getFieldValue("parameters") || {}
            let normalizedSettings = {...parameters}

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

            const {testcaseObj} = mapTestcaseAndEvalValues(
                normalizedSettings,
                selectedTestcase.testcase,
            )

            let outputs = {}

            if (Object.keys(testcaseObj).length) {
                outputs = {...outputs, ...testcaseObj}
            }

            const parseVersion = (raw: unknown, fallback: number) => {
                if (raw === undefined || raw === null) return fallback
                const match = String(raw).match(/\d+(\.\d+)?/)
                return match ? parseFloat(match[0]) : fallback
            }

            const evaluatorVersion = parseVersion(parameters.version, 1)

            const allowGroundTruthKey = !(
                selectedEvaluator.key === "auto_custom_code_run" && evaluatorVersion >= 2
            )

            const correctAnswerKey = allowGroundTruthKey ? parameters.correct_answer_key : undefined
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

            const hasValidGroundTruthKey =
                typeof groundTruthKey === "string" && groundTruthKey.trim().length > 0

            const rawGT = hasValidGroundTruthKey
                ? selectedTestcase?.["testcase"]?.[groundTruthKey]
                : undefined
            const includeGroundTruth =
                hasValidGroundTruthKey && rawGT !== undefined && rawGT !== null
            const ground_truth = includeGroundTruth ? normalizeCompact(rawGT) : ""
            const prediction = normalizeCompact(variantResult)

            outputs = {
                ...outputs,
                ...selectedTestcase.testcase,
                ...(includeGroundTruth ? {ground_truth, [groundTruthKey]: ground_truth} : {}),
                prediction,
                ...(selectedEvaluator.key === "auto_custom_code_run" ? {app_config: {}} : {}),
            }

            const evaluatorKey = resolveEvaluatorKey(evaluatorConfig) || selectedEvaluator?.key
            const evaluatorUri =
                evaluatorConfig?.data?.uri ||
                (evaluatorKey ? buildEvaluatorUri(evaluatorKey) : undefined)
            const evaluatorUrl = evaluatorConfig?.data?.url

            if (!evaluatorUri && !evaluatorUrl) {
                setOutputResult(
                    "Evaluator interface is missing (uri/url). Save the evaluator and try again.",
                )
                setEvalOutputStatus({success: false, error: true})
                return
            }

            const evaluatorParameters = transformTraceKeysInSettings(normalizedSettings)
            const parsedVariantOutput = safeParse(variantResult, variantResult)
            const workflowOutputs =
                variantResult !== ""
                    ? parsedVariantOutput
                    : (baseResponseData?.data ?? parsedVariantOutput)

            const tracePayload = (() => {
                const t = traceTree?.trace
                if (!t) return undefined
                if (typeof t === "string") {
                    try {
                        const parsed = safeJson5Parse(t)
                        return parsed && typeof parsed === "object" ? parsed : undefined
                    } catch {
                        return undefined
                    }
                }
                return t
            })()

            const workflowResponse = await invokeEvaluator({
                uri: evaluatorUri,
                url: evaluatorUrl,
                evaluator: evaluatorConfig,
                inputs: outputs,
                outputs: workflowOutputs,
                trace: tracePayload,
                parameters: evaluatorParameters,
                references: applicationReferences,
                links: lastInvocationLink ? {application: lastInvocationLink} : undefined,
                options: {signal: controller.signal},
            })
            const runResponse = mapWorkflowResponseToEvaluatorOutput(workflowResponse)
            setEvalOutputStatus({success: true, error: false})

            setOutputResult(getStringOrJson(runResponse.outputs))
        } catch (error: any) {
            if (controller.signal.aborted) {
                setOutputResult("Evaluation cancelled")
                setEvalOutputStatus({success: false, error: false})
                return
            }

            console.error(error)
            setEvalOutputStatus({success: false, error: true})

            if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
                setOutputResult(
                    "Request timed out. The evaluator is taking too long to respond. Please try again.",
                )
            } else if (error.code === "ERR_NETWORK" || error.message?.includes("Network Error")) {
                setOutputResult("Network error. Please check your connection and try again.")
            } else if (error.response?.data?.detail) {
                const errorDetail =
                    typeof error.response.data.detail === "string"
                        ? error.response.data.detail
                        : formatJson(error.response.data.detail)
                setOutputResult(getStringOrJson(errorDetail))
            } else if (error.response?.status) {
                setOutputResult(
                    `Server error (${error.response.status}): ${error.response.statusText || "Unknown error"}`,
                )
            } else {
                setOutputResult(error.message || "An unexpected error occurred")
            }
        } finally {
            setIsLoadingResult(false)
            evaluatorAbortRef.current = null
        }
    }

    const cancelEvaluatorRun = () => {
        if (evaluatorAbortRef.current) {
            evaluatorAbortRef.current.abort()
        }
    }

    const handleRunVariant = async () => {
        if (availableApps.length === 0 && derivedVariants.length === 0) {
            message.info("Create an app first to run a variant.")
            return
        }
        if (!selectedTestcase.testcase || !selectedVariant) {
            return
        }
        const controller = new AbortController()
        abortControllersRef.current = controller

        try {
            setVariantStatus({success: false, error: false})
            setIsRunningVariant(true)
            setLastInvocationLink(null)

            const params = {} as {
                inputs: Parameter[]
                parameters: unknown
                isChatVariant: boolean
                isCustom: boolean
                messages: ChatMessage[]
            }

            // Per-revision schema (always matches the selected variant)
            const safeSpec: any | undefined = revisionSchema || undefined
            const safeRoutePath: string = revisionRoutePath || ""
            const variantUrl = variantEntityData?.data?.url || selectedVariant?.uri || ""
            const safeUriObject = variantUrl
                ? {runtimePrefix: variantUrl, routePath: safeRoutePath}
                : undefined

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

                const reservedInputKeys = new Set([
                    "ag_config",
                    "inputs",
                    "environment",
                    "revision_id",
                    "variant_id",
                    "app_id",
                    "chat",
                ])

                let effectiveKeys: string[] = Array.from(
                    new Set([...(fromParams || []), ...(stableVarNames || [])]),
                ).filter((k) => k && !reservedInputKeys.has(k))

                let hasInputsProp = false
                let hasMessagesPropFromSchema = false
                if (safeSpec) {
                    const {primaryEndpoint} = extractAllEndpointSchemas(
                        safeSpec as any,
                        safeRoutePath,
                    )
                    hasInputsProp = Boolean(primaryEndpoint?.inputsSchema)
                    hasMessagesPropFromSchema = Boolean(primaryEndpoint?.messagesSchema)
                }

                const isCustomFromFlag = Boolean(isCustomFlag ?? (selectedVariant as any)?.isCustom)
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

                params.inputs = (effectiveKeys || [])
                    .filter((name) => name !== "messages")
                    .map((name) => ({name, input: false}))

                // Build raw ag_config from variant parameters
                const variantParams =
                    variantEntityData?.data?.parameters || selectedVariant?.parameters
                const payloadAgConfig = isPlainObject(revisionRequestPayload?.ag_config)
                    ? (revisionRequestPayload.ag_config as Record<string, unknown>)
                    : undefined
                const variantAgConfig =
                    payloadAgConfig ||
                    (variantParams as Record<string, unknown>)?.ag_config ||
                    variantParams ||
                    {}

                const baseParameters = transformToRequestBody({
                    variant: selectedVariant,
                    isChat,
                    isCustom,
                    rawAgConfig: variantAgConfig as Record<string, unknown>,
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
                const reservedInputKeys = new Set([
                    "ag_config",
                    "inputs",
                    "environment",
                    "revision_id",
                    "variant_id",
                    "app_id",
                ])
                let sanitizedInputs = (inputs || []).filter(
                    (p) => p?.name && !reservedInputKeys.has(p.name),
                )
                if (sanitizedInputs.length === 0) {
                    const schemaKeys = safeSpec
                        ? extractInputKeysFromSchema(safeSpec as any, safeRoutePath)
                        : []
                    if (schemaKeys.length > 0) {
                        sanitizedInputs = schemaKeys.map((name) => ({name, input: false}))
                    } else if (selectedTestcase.testcase) {
                        sanitizedInputs = Object.keys(selectedTestcase.testcase)
                            .filter(
                                (key) =>
                                    key &&
                                    !key.startsWith("__") &&
                                    !reservedInputKeys.has(key) &&
                                    key !== "messages",
                            )
                            .map((name) => ({name, input: false}))
                    }
                }
                params.inputs = sanitizedInputs
                const hasMessagesInput = Boolean(
                    (inputs || []).some((p) => p.name === "messages") ||
                    (safeSpec &&
                        extractAllEndpointSchemas(safeSpec as any, safeRoutePath)?.primaryEndpoint
                            ?.messagesSchema),
                )
                params.isChatVariant = hasMessagesInput
                params.messages = hasMessagesInput
                    ? extractChatMessages(selectedTestcase.testcase)
                    : []
                params.isCustom = selectedVariant?.isCustom

                const openApiDefaults = Array.isArray(parameters)
                    ? parameters.reduce<Record<string, unknown>>((acc, param) => {
                          if (
                              typeof param?.name === "string" &&
                              param.name.length > 0 &&
                              param.default !== undefined
                          ) {
                              acc[param.name] = param.default
                          }
                          return acc
                      }, {})
                    : isPlainObject(parameters)
                      ? {...(parameters as Record<string, unknown>)}
                      : {}

                const payloadAgConfig = isPlainObject(revisionRequestPayload?.ag_config)
                    ? (revisionRequestPayload.ag_config as Record<string, unknown>)
                    : undefined
                const variantParams =
                    variantEntityData?.data?.parameters || selectedVariant?.parameters
                const variantAgConfig = isPlainObject((variantParams as any)?.ag_config)
                    ? ((variantParams as any).ag_config as Record<string, unknown>)
                    : isPlainObject(variantParams)
                      ? (variantParams as Record<string, unknown>)
                      : undefined

                const transformedParameters = transformToRequestBody({
                    variant: selectedVariant,
                    isChat: hasMessagesInput,
                    isCustom: Boolean(params.isCustom),
                    rawAgConfig: payloadAgConfig || variantAgConfig,
                })

                const mergedParameters = {
                    ...openApiDefaults,
                    ...(isPlainObject(transformedParameters) ? transformedParameters : {}),
                }
                if (
                    !isPlainObject((mergedParameters as Record<string, unknown>).ag_config) &&
                    (payloadAgConfig || variantAgConfig)
                ) {
                    ;(mergedParameters as Record<string, unknown>).ag_config =
                        payloadAgConfig || variantAgConfig
                }
                params.parameters = mergedParameters

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

            const workflowParameters = isPlainObject((params.parameters as any)?.ag_config)
                ? ((params.parameters as any).ag_config as Record<string, any>)
                : isPlainObject(params.parameters)
                  ? (params.parameters as Record<string, any>)
                  : {}

            const workflowInputs: Record<string, any> = {...filtered}
            if (
                params.isChatVariant &&
                Array.isArray(params.messages) &&
                params.messages.length > 0
            ) {
                workflowInputs.messages = params.messages
            }

            // Prefer unified workflow invocation for completion/chat app flows.
            // Keep legacy /test fallback for custom apps and unknown interfaces.
            const workflowUriCandidate = (() => {
                const rawUri =
                    typeof selectedVariant?.uri === "string" ? selectedVariant.uri.trim() : ""
                if (rawUri && !rawUri.includes("://")) {
                    return rawUri
                }
                if (params.isChatVariant) return "agenta:builtin:chat:v0"
                if (!params.isCustom) return "agenta:builtin:completion:v0"
                return ""
            })()

            if (!params.isCustom && workflowUriCandidate) {
                const workflowResponse = await invokeApplication({
                    uri: workflowUriCandidate,
                    inputs: workflowInputs,
                    parameters: workflowParameters,
                    references: applicationReferences,
                    options: {signal: controller.signal},
                })

                const runResponse = mapWorkflowResponseToOutputs(workflowResponse)
                const outputs = runResponse.outputs ?? {}
                setLastInvocationLink(extractLinkFromWorkflowResponse(workflowResponse) ?? null)
                setBaseResponseData({
                    version: workflowResponse.version,
                    data: outputs,
                })
                setVariantResult(getStringOrJson(outputs))
                setTraceTree({trace: null})
                setVariantStatus({success: true, error: false})
                return
            }

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
                setLastInvocationLink(null)
                setVariantResult(getStringOrJson(result))
                setTraceTree({trace: result})
                setVariantStatus({success: true, error: false})
            } else if (isFuncResponse(result)) {
                setLastInvocationLink(null)
                setVariantResult(getStringOrJson(result))
                setTraceTree({trace: result})
                setVariantStatus({success: true, error: false})
            } else if (isBaseResponse(result)) {
                setLastInvocationLink(extractLinkFromBaseResponse(result) ?? null)
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
        () => `testcase-${selectedRevisionId}-${JSON.stringify(selectedTestcase.testcase ?? {})}`,
        [selectedRevisionId, selectedTestcase.testcase],
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
    const appName = selectedApp?.name || selectedApp?.slug || "app"
    const variantName = selectedVariant?.variantName || "variant"

    // Guard: if no evaluator selected, show nothing (shouldn't happen in normal flow)
    if (!selectedEvaluator) {
        return null
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <Space size={5}>
                        <Typography.Text className={classes.formTitleText}>
                            Testcase
                        </Typography.Text>

                        {activeTestsetLabel && selectedTestcase.testcase && (
                            <>
                                <CheckCircleOutlined style={{color: "green"}} />
                                <Typography.Text type="secondary">
                                    <span className="inline-flex items-center gap-2">
                                        <span>{activeTestsetLabel.name}</span>
                                        {typeof activeTestsetLabel.version === "number" && (
                                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-md leading-none">
                                                v{activeTestsetLabel.version}
                                            </span>
                                        )}
                                    </span>
                                </Typography.Text>
                            </>
                        )}
                    </Space>

                    <Tooltip placement="bottom" title="">
                        <Button
                            size="small"
                            className="flex items-center gap-2"
                            onClick={() => setOpenTestcaseModal(true)}
                        >
                            <Database />
                            Load testcase
                        </Button>
                    </Tooltip>
                </div>

                <div className="w-full overflow-hidden">
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
                        <Space.Compact>
                            <Button
                                size="small"
                                disabled={!selectedTestcase.testcase}
                                loading={isRunningVariant}
                                onClick={handleRunVariant}
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
                                    Run application ({appName}/{variantName})
                                </div>
                            </Button>
                            <Dropdown
                                open={dropdownOpen}
                                onOpenChange={setDropdownOpen}
                                menu={{
                                    items: [
                                        {
                                            key: "change_variant",
                                            icon: <Lightning />,
                                            label: "Change application",
                                        },
                                    ],
                                    onClick: (info) => {
                                        if (info.key === "change_variant") {
                                            setDropdownOpen(false)
                                            setOpenVariantModal(true)
                                        }
                                    },
                                }}
                                trigger={["click"]}
                            >
                                <Button
                                    size="small"
                                    icon={<MoreOutlined />}
                                    disabled={!selectedTestcase.testcase}
                                />
                            </Dropdown>
                        </Space.Compact>
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
                    {isLoadingResult ? (
                        <Button
                            size="small"
                            className="w-[120px]"
                            danger
                            onClick={cancelEvaluatorRun}
                        >
                            <CloseCircleOutlined />
                            Cancel
                        </Button>
                    ) : (
                        <Tooltip
                            title={baseResponseData ? "" : "Run application first"}
                            placement="bottom"
                        >
                            <Button
                                className="flex items-center gap-2"
                                size="small"
                                onClick={fetchEvalMapper}
                                disabled={!baseResponseData}
                            >
                                <Play /> Run evaluator
                            </Button>
                        </Tooltip>
                    )}
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

            <EvaluatorVariantModal
                variants={derivedVariants}
                open={openVariantModal}
                onCancel={() => setOpenVariantModal(false)}
                setSelectedVariant={(v) => {
                    setSelectedVariant(v)
                    // Persist selection via atoms
                    if ((v as any)?.appId) setLastAppId((v as any).appId)
                    if ((v as any)?.variantId) setLastVariantId((v as any).variantId)
                }}
                selectedVariant={selectedVariant}
                selectedRevisionId={selectedRevisionId}
            />
            <LoadTestsetModal
                open={openTestcaseModal}
                onCancel={() => setOpenTestcaseModal(false)}
                setTestsetData={handleEvaluatorTestsetData}
                selectionMode="single"
            />
        </div>
    )
}

export default DebugSection
