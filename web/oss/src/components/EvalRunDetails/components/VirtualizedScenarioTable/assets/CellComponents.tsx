import {HTMLProps, ReactNode, memo, useMemo} from "react"

import {ArrowsOut} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import TooltipButton from "@/oss/components/Playground/assets/EnhancedButton"
import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import {useOptionalRunId, useRunId} from "@/oss/contexts/RunIdContext"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"
import {resolvePath} from "@/oss/lib/evalRunner/pureEnrichment"
import {dataUriToObjectUrl, isBase64} from "@/oss/lib/helpers/utils"
import {useAppNavigation, useAppState} from "@/oss/state/appState"

import {
    hasScenarioStepData,
    useScenarioStepSnapshot,
} from "../../../../../lib/hooks/useEvaluationRunData/useScenarioStepSnapshot"
import {renderChatMessages} from "../../../assets/renderChatMessages"
import {evalTypeAtom} from "../../../state/evalType"
import {TableRow} from "../types"

import {titleCase} from "./flatDataSourceBuilder"
const GenerationResultUtils = dynamic(
    () =>
        import(
            "@agenta/oss/src/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false, loading: () => <div className="h-[24.4px] w-full" />},
)
const WRAPPER_KEYS = new Set([
    "inputs",
    "input",
    "data",
    "result",
    "attribute",
    "attributes",
    "payload",
    "request",
    "requestBody",
    "body",
    "value",
])

const tryParseJson = (value: any) => {
    if (typeof value !== "string") return value
    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

const unwrapForDisplay = (value: any, preferredKeys: string[] = []): any => {
    if (value == null) return value
    const normalized = tryParseJson(value)
    if (normalized !== value) return unwrapForDisplay(normalized, preferredKeys)
    if (Array.isArray(value)) return value
    if (typeof value !== "object") return value
    if (Array.isArray(value)) return value
    if (typeof value !== "object") return value

    for (const key of preferredKeys) {
        if (value && Object.prototype.hasOwnProperty.call(value, key)) {
            return unwrapForDisplay(value[key], preferredKeys)
        }
    }

    const entries = Object.entries(value ?? {})
    if (entries.length === 1) {
        const [key, nested] = entries[0]
        if (WRAPPER_KEYS.has(key)) {
            return unwrapForDisplay(nested, preferredKeys)
        }
    }
    return value
}

const buildFileLink = (value: any): {filename: string; href: string} | null => {
    if (!value || typeof value !== "object") return null
    const payload =
        value.type === "file" && value.file && typeof value.file === "object"
            ? value.file
            : value.file && typeof value.file === "object"
              ? value.file
              : value

    if (!payload || typeof payload !== "object") return null

    const fileId = payload.file_id ?? payload.fileId
    const fileData = payload.file_data ?? payload.fileData
    const hasResolvableData = Boolean(
        (typeof fileId === "string" && fileId) ||
            (typeof fileData === "string" && isBase64(fileData)),
    )

    if (!hasResolvableData) return null

    const format = payload.format ?? payload.file_format
    const rawName =
        payload.name ??
        payload.filename ??
        payload.original_filename ??
        (value.type === "file" && typeof value.filename === "string" ? value.filename : "Document")

    const filename =
        format && rawName && !rawName.endsWith(`.${format}`)
            ? `${rawName}.${format}`
            : rawName || "Document"

    let href = typeof fileId === "string" && fileId ? fileId : ""
    if (!href && typeof fileData === "string" && isBase64(fileData)) {
        href = dataUriToObjectUrl(fileData)
    }
    if (!href) return null

    return {filename, href}
}

const wrapValuesInLines = (values: (ReactNode | string)[], keyPrefix: string) => {
    return (
        <span className="flex flex-col gap-2">
            {values.map((entry, index) => (
                <span key={`${keyPrefix}-${index}`} className="whitespace-pre-line">
                    {entry}
                </span>
            ))}
        </span>
    )
}

const formatPrimitiveValue = (value: any): ReactNode => {
    if (value == null) return ""
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        const formattedItems = value
            .map((item) => formatPrimitiveValue(unwrapForDisplay(item)))
            .filter((item) => item !== "" && item !== null && item !== undefined)
        if (!formattedItems.length) return ""
        const onlyStrings = formattedItems.every((item) => typeof item === "string")
        if (onlyStrings) {
            return (formattedItems as string[]).join("\n")
        }
        return wrapValuesInLines(formattedItems, "primitive-array")
    }
    if (typeof value === "object") {
        const fileLink = buildFileLink(value)
        if (fileLink) {
            return (
                <a href={fileLink.href} target="_blank" rel="noreferrer" className="text-[#1677ff]">
                    {fileLink.filename}
                </a>
            )
        }

        const entries = Object.entries(value ?? {})
            .map(([key, nested]) => {
                const formatted = formatPrimitiveValue(unwrapForDisplay(nested))
                if (formatted === "" || formatted === null || formatted === undefined) return null
                return {key: titleCase(key), formatted}
            })
            .filter(Boolean) as {key: string; formatted: ReactNode}[]

        if (!entries.length) return ""
        const allStrings = entries.every(({formatted}) => typeof formatted === "string")
        if (allStrings) {
            return entries
                .map(({key, formatted}) => `${key}: ${formatted as string}`)
                .filter(Boolean)
                .join("\n")
        }

        const nodes = entries.map(({key, formatted}) => (
            <span className="whitespace-pre-line">
                <span>{key}: </span>
                {formatted}
            </span>
        ))
        return wrapValuesInLines(nodes, "primitive-object")
    }
    return String(value)
}

const stringifyOnlineValue = (value: any, depth = 0): string => {
    const unwrapped = unwrapForDisplay(value)
    if (unwrapped == null) return ""
    if (typeof unwrapped === "string") return unwrapped
    if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped)
    if (Array.isArray(unwrapped)) {
        return unwrapped
            .map((item) => stringifyOnlineValue(item, depth))
            .filter(Boolean)
            .join(depth === 0 ? "\n" : ", ")
    }
    if (typeof unwrapped === "object") {
        const entries = Object.entries(unwrapped)
        if (!entries.length) return ""
        return entries
            .map(([key, nested]) => {
                const rendered = stringifyOnlineValue(nested, depth + 1)
                if (!rendered) return ""
                return depth === 0 ? rendered : `${titleCase(key)}: ${rendered}`
            })
            .filter(Boolean)
            .join(depth === 0 ? "\n" : ", ")
    }
    return String(unwrapped)
}

const isChatMessage = (entry: any) =>
    entry && typeof entry === "object" && "role" in entry && "content" in entry

const buildOnlineInputItems = (
    value: any,
): {label?: string; value?: string; chat?: ReactNode[]}[] => {
    const unwrapped = unwrapForDisplay(value, ["inputs", "input", "data", "requestBody", "body"])
    if (unwrapped == null) return []
    if (Array.isArray(unwrapped) && unwrapped.every(isChatMessage)) {
        return [
            {
                label: "Messages",
                chat: renderChatMessages({
                    keyPrefix: "input",
                    rawJson: JSON.stringify(unwrapped),
                    view: "table",
                }),
            },
        ]
    }
    if (typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
        const valueStr = stringifyOnlineValue(unwrapped, 0)
        return valueStr ? [{value: valueStr}] : []
    }

    return Object.entries(unwrapped)
        .map(([key, nested]) => {
            if (isChatMessage(nested)) {
                return {
                    label: titleCase(key),
                    chat: renderChatMessages({
                        keyPrefix: `input-${key}`,
                        rawJson: JSON.stringify([nested]),
                        view: "table",
                    }),
                }
            }
            if (Array.isArray(nested) && nested.every(isChatMessage)) {
                return {
                    label: titleCase(key),
                    chat: renderChatMessages({
                        keyPrefix: `input-${key}`,
                        rawJson: JSON.stringify(nested),
                        view: "table",
                    }),
                }
            }
            const rendered = stringifyOnlineValue(nested, 0)
            if (!rendered) return null
            const label = titleCase(key)
            const sanitized = rendered.startsWith(`${label}: `)
                ? rendered.slice(label.length + 2)
                : rendered
            return {label, value: sanitized}
        })
        .filter(Boolean) as {label?: string; value?: string; chat?: ReactNode[]}[]
}

const buildOnlineOutput = (
    rawValue: any,
    fallback: any,
    keyPrefix: string,
): {text?: ReactNode; chat?: ReactNode[]} => {
    const candidates = [rawValue, fallback]
    for (const candidate of candidates) {
        if (candidate == null) continue
        const parsed = unwrapForDisplay(candidate, ["outputs", "output", "response", "text"])
        if (Array.isArray(parsed) && parsed.every(isChatMessage)) {
            return {
                chat: renderChatMessages({
                    keyPrefix,
                    rawJson: JSON.stringify(parsed),
                    view: "table",
                }),
            }
        }
        if (parsed && typeof parsed === "object" && isChatMessage(parsed)) {
            return {
                chat: renderChatMessages({
                    keyPrefix,
                    rawJson: JSON.stringify([parsed]),
                    view: "table",
                }),
            }
        }
        const formatted = formatPrimitiveValue(parsed)
        if (formatted) {
            return {text: formatted}
        }
    }
    return {text: formatPrimitiveValue(fallback)}
}

export const CellWrapper = memo(
    ({children, className, style, ...rest}: HTMLProps<HTMLDivElement>) => {
        return (
            <div
                className={clsx([
                    "w-full h-full",
                    "flex items-start",
                    "bg-inherit",
                    "overflow-hidden",
                    "group",
                    className,
                ])}
                style={style}
                {...rest}
            >
                {children}
            </div>
        )
    },
)

export const InputCell = memo(
    ({
        scenarioId,
        inputKey,
        stepKey,
        showEditor = true,
        disableExpand = false,
        runId,
    }: {
        scenarioId: string
        inputKey: string
        stepKey?: string
        showEditor?: boolean
        disableExpand?: boolean
        runId?: string
    }) => {
        const evalType = useAtomValue(evalTypeAtom)

        // Use effective runId with proper fallback logic
        const contextRunId = useRunId()
        const effectiveRunId = useMemo(() => runId ?? contextRunId ?? null, [runId, contextRunId])

        const {data: stepData} = useScenarioStepSnapshot(scenarioId, effectiveRunId)
        const hasStepData = hasScenarioStepData(stepData)
        const enrichedArr = hasStepData ? (stepData?.inputSteps ?? []) : []
        let targetStep = stepKey ? enrichedArr.find((s) => s.stepKey === stepKey) : undefined
        if (!targetStep) targetStep = enrichedArr[0]
        const invocationStep = hasStepData ? stepData?.invocationSteps?.[0] : undefined

        let val: any
        if (hasStepData && targetStep && (targetStep as any).inputs) {
            let _inputs = {}
            try {
                const {testcase_dedup_id, ...rest} = targetStep.testcase.data
                _inputs = {...(targetStep as any).inputs, ...rest}
            } catch (e) {
                _inputs = {}
            }

            const inputs = {..._inputs}
            const groundTruth = (targetStep as any).groundTruth ?? {}
            // Merge like InvocationInputs: groundTruth first, then inputs override duplicates
            const merged = {...groundTruth, ...inputs}
            const path = inputKey.startsWith("data.") ? inputKey.slice(5) : inputKey
            val = resolvePath(merged, path)
        }

        if (val === undefined && hasStepData && invocationStep) {
            const evResult =
                resolvePath(invocationStep?.inputs, inputKey) ??
                resolvePath(invocationStep?.data, inputKey) ??
                resolvePath(invocationStep?.result, inputKey)
            if (evResult !== undefined) val = evResult
        }

        if (val === undefined && invocationStep?.trace) {
            const tryTrace = resolvePath(invocationStep.trace, inputKey)
            if (tryTrace !== undefined) val = tryTrace
        }

        // Use shared util for complex chat messages, otherwise primitive display
        let isChat = false
        let reactNodes: React.ReactNode[] | undefined
        if (typeof val === "string") {
            try {
                const parsed = JSON.parse(val)
                isChat =
                    Array.isArray(parsed) && parsed.every((m: any) => "role" in m && "content" in m)
            } catch {
                /* ignore */
            }
        }
        if (isChat) {
            reactNodes = renderChatMessages({
                keyPrefix: `${scenarioId}-${inputKey}`,
                rawJson: val as string,
                view: "table",
            })
        }

        const isOnlineEval = evalType === "online"
        const onlineInputItems = useMemo(() => {
            if (!hasStepData || !isOnlineEval || reactNodes) return []

            const candidateValues: any[] = [val]
            if (invocationStep) {
                candidateValues.push(
                    invocationStep?.trace?.data?.inputs,
                    invocationStep?.trace?.data?.inputs?.inputs,
                    invocationStep?.trace?.inputs,
                    invocationStep?.inputs,
                    invocationStep?.data?.inputs,
                    invocationStep?.data,
                )
            }
            if (targetStep) {
                candidateValues.push((targetStep as any).inputs, (targetStep as any).groundTruth)
            }

            for (const candidate of candidateValues) {
                if (!candidate) continue
                const items = buildOnlineInputItems(candidate)
                if (items.length) return items
            }

            return []
        }, [hasStepData, isOnlineEval, reactNodes, val, invocationStep, targetStep])
        const showOnlineLabels = showEditor !== false

        if (!hasStepData) {
            return (
                <CellWrapper>
                    <span className="text-gray-400">—</span>
                </CellWrapper>
            )
        }

        return (
            <CellWrapper>
                <Expandable
                    disableExpand={disableExpand}
                    expandKey={scenarioId}
                    className={clsx([
                        "bg-transparent [&_.cell-expand-container]:!bg-transparent",
                        "[&_.agenta-shared-editor]:hover:!border-transparent",
                        {
                            "[&_.agenta-shared-editor]:p-0": !reactNodes,
                        },
                    ])}
                >
                    {reactNodes ? (
                        <div className="flex flex-col gap-2 w-full">{reactNodes}</div>
                    ) : isOnlineEval ? (
                        onlineInputItems.length ? (
                            <div className="flex flex-col gap-2 w-full leading-5 text-gray-700">
                                {onlineInputItems.map((item, index) => (
                                    <div
                                        key={`${scenarioId}-${inputKey}-${index}`}
                                        className="flex flex-col gap-0.5 whitespace-pre-line"
                                    >
                                        {showOnlineLabels && item.label ? (
                                            <span className="font-medium text-gray-500">
                                                {item.label}
                                            </span>
                                        ) : null}
                                        {item.chat ? (
                                            <div className="flex flex-col gap-2">{item.chat}</div>
                                        ) : (
                                            <span>{item.value}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <span className="text-gray-400">N/A</span>
                        )
                    ) : val != null && val !== "" && !showEditor ? (
                        <div>{String(val)}</div>
                    ) : val != null && val !== "" ? (
                        <SharedEditor
                            className="!bg-transparent !border-none !shadow-none"
                            handleChange={() => {}}
                            initialValue={String(val)}
                            editorType="borderless"
                            placeholder="Click the 'Run' icon to get variant output"
                            disabled
                            editorClassName="!text-xs"
                            editorProps={{enableResize: true}}
                        />
                    ) : (
                        <span>N/A</span>
                    )}
                </Expandable>
            </CellWrapper>
        )
    },
)

export const InputSummaryCell = memo(
    ({scenarioId, runId}: {scenarioId: string; runId?: string}) => {
        const contextRunId = useRunId()
        const evalType = useAtomValue(evalTypeAtom)
        const effectiveRunId = useMemo(() => runId ?? contextRunId ?? null, [runId, contextRunId])

        const {data: stepData} = useScenarioStepSnapshot(scenarioId, effectiveRunId)

        if (!hasScenarioStepData(stepData)) {
            return (
                <CellWrapper>
                    <span className="text-gray-400">—</span>
                </CellWrapper>
            )
        }

        const inputSteps = stepData?.inputSteps ?? []

        const combined = new Map<string, any>()
        const structured: Record<string, any> = {}

        const deepMerge = (target: Record<string, any>, source?: Record<string, any>) => {
            if (!source || typeof source !== "object") return target
            Object.entries(source).forEach(([key, rawValue]) => {
                // Prevent prototype pollution by excluding dangerous keys
                if (key === "__proto__" || key === "constructor" || key === "prototype") return
                const parsed = tryParseJson(rawValue)
                const value = parsed
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    target[key] = deepMerge((target[key] ||= {}), value as Record<string, any>)
                } else {
                    target[key] = value
                }
            })
            return target
        }

        const flattenInto = (value: any, path: string[] = []) => {
            if (value == null) return
            const parsed = tryParseJson(value)
            if (parsed !== value) {
                flattenInto(parsed, path)
                return
            }
            if (Array.isArray(value)) {
                const keyPath = path.join(".")
                if (
                    value.length &&
                    value.every(
                        (entry) =>
                            entry &&
                            typeof entry === "object" &&
                            "role" in entry &&
                            "content" in entry,
                    )
                ) {
                    if (!combined.has(keyPath || "messages")) {
                        combined.set(keyPath || "messages", value)
                    }
                    return
                }

                if (value.length && value.every((entry) => typeof entry !== "object")) {
                    const joined = value.map((entry) => String(entry)).join(", ")
                    if (keyPath && !combined.has(keyPath)) {
                        combined.set(keyPath, joined)
                    }
                    return
                }

                value.forEach((entry, index) => flattenInto(entry, [...path, String(index)]))
                return
            }
            if (typeof value === "object") {
                Object.entries(value).forEach(([key, nested]) => {
                    flattenInto(nested, [...path, key])
                })
                return
            }
            if (!path.length) return
            const keyPath = path.join(".")
            if (!combined.has(keyPath)) {
                combined.set(keyPath, value)
            }
        }

        const mergeCandidate = (source?: Record<string, any>) => {
            if (!source || typeof source !== "object") return
            flattenInto(source)
            deepMerge(structured, source)
        }

        inputSteps.forEach((step: any) => {
            mergeCandidate(step?.groundTruth)
            mergeCandidate(step?.inputs)
            try {
                const {testcase_dedup_id, ...rest} = step?.testcase?.data ?? {}
                mergeCandidate(rest)
            } catch {
                /* ignore */
            }
        })

        const invocationStep = stepData?.invocationSteps?.[0]

        if (invocationStep) {
            mergeCandidate(invocationStep?.inputs)
            const invocationParams = invocationStep?.invocationParameters
            if (invocationParams && typeof invocationParams === "object") {
                Object.values(invocationParams).forEach((param: any) => {
                    mergeCandidate(param?.requestBody?.inputs)
                    mergeCandidate(param?.inputs)
                    mergeCandidate(param?.agConfig?.inputs)
                })
            }

            const collectTraceInputs = (node: any) => {
                if (!node || typeof node !== "object") return
                if (node.inputs && typeof node.inputs === "object") mergeCandidate(node.inputs)
                if (node.data && typeof node.data === "object") {
                    if (node.data.inputs && typeof node.data.inputs === "object") {
                        mergeCandidate(node.data.inputs)
                    }
                }
                const children = ([] as any[])
                    .concat(node?.nodes || [])
                    .concat(node?.children || [])
                    .concat(node?.events || [])
                children.forEach(collectTraceInputs)
            }

            if (invocationStep?.trace) {
                collectTraceInputs(invocationStep.trace)
                if (invocationStep.trace?.tree) collectTraceInputs(invocationStep.trace.tree)
            }
        }

        if (!combined.size) {
            return (
                <CellWrapper>
                    <span className="text-gray-400">—</span>
                </CellWrapper>
            )
        }

        const buildOnlineItems = () => {
            const items: {label: string; value?: string; chat?: ReactNode[]}[] = []
            for (const [path, value] of combined.entries()) {
                const segments = path.split(".").filter(Boolean)
                while (segments.length && WRAPPER_KEYS.has(segments[0])) {
                    segments.shift()
                }
                if (!segments.length) continue
                const label = titleCase(segments[segments.length - 1])

                if (Array.isArray(value) && value.every(isChatMessage)) {
                    const nodes = renderChatMessages({
                        keyPrefix: `${scenarioId}-${label}`,
                        rawJson: JSON.stringify(value),
                        view: "table",
                    })
                    items.push({label, chat: nodes})
                    continue
                }

                if (isChatMessage(value)) {
                    const nodes = renderChatMessages({
                        keyPrefix: `${scenarioId}-${label}`,
                        rawJson: JSON.stringify([value]),
                        view: "table",
                    })
                    items.push({label, chat: nodes})
                    continue
                }

                const rendered = stringifyOnlineValue(value, 0)
                if (!rendered) continue
                const sanitized = rendered.startsWith(`${label}: `)
                    ? rendered.slice(label.length + 2)
                    : rendered
                items.push({label, value: sanitized})
            }
            return items
        }

        if (evalType === "online") {
            const items = buildOnlineItems()
            if (!items.length) {
                return (
                    <CellWrapper>
                        <span className="text-gray-400">—</span>
                    </CellWrapper>
                )
            }

            return (
                <CellWrapper>
                    <Expandable
                        expandKey={`${scenarioId}-inputs-summary`}
                        className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                    >
                        <div className="flex flex-col gap-2 w-full leading-5 text-gray-700 whitespace-pre-line">
                            {items.map(({label, value, chat}) => (
                                <div key={`${scenarioId}-${label}`} className="flex flex-col gap-1">
                                    <span className="font-semibold text-gray-500">{label}</span>
                                    {chat ? (
                                        <div className="flex flex-col gap-2">{chat}</div>
                                    ) : (
                                        <span>{value}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Expandable>
                </CellWrapper>
            )
        }

        const serialized = (() => {
            try {
                return JSON.stringify(structured, null, 2)
            } catch {
                return String(structured)
            }
        })()

        return (
            <CellWrapper>
                <Expandable
                    expandKey={`${scenarioId}-inputs-summary`}
                    className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                >
                    <SharedEditor
                        className="!bg-transparent !border-none !shadow-none"
                        handleChange={() => {}}
                        initialValue={serialized}
                        editorType="borderless"
                        disabled
                        editorClassName="!text-xs"
                        editorProps={{enableResize: true}}
                    />
                </Expandable>
            </CellWrapper>
        )
    },
)

// Dynamic invocation result cell for run-index driven columns
export const InvocationResultCellSkeleton = memo(() => {
    return (
        <CellWrapper className="flex flex-col !items-start justify-between gap-2 text-wrap"></CellWrapper>
    )
})

export const InvocationResultCell = memo(
    ({
        scenarioId,
        stepKey,
        path,
        isSkeleton,
        runId,
        record,
    }: {
        isSkeleton: boolean
        scenarioId: string
        stepKey: string
        path: string
        runId?: string // Optional for multi-run support
        record?: TableRow
    }) => {
        const evalType = useAtomValue(evalTypeAtom)
        const {trace, value, rawValue, messageNodes, hasError} = useInvocationResult({
            scenarioId,
            stepKey,
            runId,
            viewType: "table",
        })
        const navigation = useAppNavigation()
        const appState = useAppState()
        const contextRunId = useOptionalRunId()
        const enableFocusDrawer =
            evalType === "auto" || evalType === "online" || evalType === "custom"

        const handleOpenFocus = () => {
            const targetRunId = runId ?? contextRunId ?? null
            if (!targetRunId) {
                console.warn("[InvocationResultCell] Missing runId while opening focus view", {
                    scenarioId,
                })
                return
            }

            const currentScenarioValue = appState.query?.focusScenarioId
            const currentRunValue = appState.query?.focusRunId
            const scenarioMatches = Array.isArray(currentScenarioValue)
                ? currentScenarioValue[0] === scenarioId
                : currentScenarioValue === scenarioId
            const runMatches = Array.isArray(currentRunValue)
                ? currentRunValue[0] === targetRunId
                : currentRunValue === targetRunId

            if (!scenarioMatches || !runMatches) {
                navigation.patchQuery(
                    {
                        focusScenarioId: scenarioId,
                        focusRunId: targetRunId,
                    },
                    {shallow: true},
                )
            }
        }

        const isOnlineEval = evalType === "online"
        console.log("isOnlineEval", isOnlineEval)
        const onlineOutput = useMemo(() => {
            if (!isOnlineEval) return {text: undefined, chat: undefined}
            if (messageNodes) return {text: undefined, chat: messageNodes}
            return buildOnlineOutput(rawValue, value, `${scenarioId}-output`)
        }, [isOnlineEval, messageNodes, rawValue, value, scenarioId])

        const formattedPrimitive = useMemo(() => {
            if (value === null || value === undefined) return ""
            if (typeof value === "string") {
                try {
                    const parsed = JSON.parse(value)
                    if (parsed && typeof parsed === "object") {
                        return JSON.stringify(parsed, null, 2)
                    }
                } catch {
                    /* ignore parse errors */
                }
                return value
            }
            if (typeof value === "object") {
                try {
                    return JSON.stringify(value, null, 2)
                } catch {
                    return String(value)
                }
            }
            return String(value)
        }, [value])

        return (
            <CellWrapper className="flex flex-col !items-start justify-between gap-2 text-wrap">
                {!isSkeleton && enableFocusDrawer ? (
                    <TooltipButton
                        icon={<ArrowsOut size={14} className="ml-[1px] mt-[1px]" />}
                        size="small"
                        className="absolute top-2 right-2 z-[2] hidden group-hover:block"
                        onClick={handleOpenFocus}
                        tooltipProps={{title: "Focus view"}}
                    />
                ) : null}
                {isSkeleton ? (
                    <>
                        <div className="h-[70px] w-full m-3"></div>
                        <div className="h-[24.4px] w-full" />
                    </>
                ) : messageNodes ? (
                    <>
                        {/* <ScenarioTraceSummary
                            scenarioId={scenarioId}
                            stepKey={summaryStepKey}
                            runId={runId}
                            trace={trace}
                            status={status}
                            className="w-full"
                        /> */}
                        <Expandable
                            className="[&_.agenta-shared-editor]:hover:!border-transparent"
                            expandKey={scenarioId}
                            buttonProps={{
                                className: enableFocusDrawer ? "!right-7" : "top-0",
                            }}
                        >
                            <div className="flex flex-col gap-2 w-full">{messageNodes}</div>
                        </Expandable>
                    </>
                ) : onlineOutput.chat?.length ? (
                    <>
                        <Expandable
                            className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                            expandKey={scenarioId}
                            buttonProps={{
                                className: enableFocusDrawer ? "!right-7" : "top-0",
                            }}
                        >
                            <div className="flex flex-col gap-2 w-full">{onlineOutput.chat}</div>
                        </Expandable>
                    </>
                ) : onlineOutput.text ? (
                    <>
                        <Expandable
                            className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                            expandKey={scenarioId}
                            buttonProps={{
                                className: enableFocusDrawer ? "!right-7" : "top-0",
                            }}
                        >
                            <div className="w-full h-max whitespace-pre-line text-gray-700">
                                {onlineOutput.text}
                            </div>
                        </Expandable>
                    </>
                ) : (
                    <>
                        {/* <ScenarioTraceSummary
                            scenarioId={scenarioId}
                            stepKey={summaryStepKey}
                            runId={runId}
                            trace={trace}
                            status={status}
                            className="w-full"
                        /> */}
                        <Expandable
                            className="[&_.agenta-shared-editor]:hover:!border-transparent [&_.agenta-shared-editor]:!p-0"
                            expandKey={scenarioId}
                            buttonProps={{
                                className: enableFocusDrawer ? "!right-7" : "top-0",
                            }}
                        >
                            <div className="w-full h-max">
                                {formattedPrimitive ? (
                                    <pre
                                        className={clsx(
                                            "whitespace-pre-wrap break-words text-xs",
                                            hasError ? "text-red-500" : "text-gray-700",
                                        )}
                                    >
                                        {formattedPrimitive}
                                    </pre>
                                ) : null}
                            </div>
                        </Expandable>
                    </>
                )}
                {trace ? (
                    <div className="flex gap-2">
                        <GenerationResultUtils
                            showStatus={false}
                            result={{
                                response: {
                                    tree: {
                                        nodes: [trace],
                                    },
                                },
                            }}
                        />
                        {/* <StatusCell scenarioId={scenarioId} result={record?.result} runId={runId} /> */}
                    </div>
                ) : (
                    <div className="h-[24.4px] w-full" />
                )}
            </CellWrapper>
        )
    },
)

export const SkeletonCell = () => {
    return (
        <CellWrapper className="min-h-[32px] [&_*]:!min-w-full [&_*]:!w-full [&_*]:!max-w-full justify-center">
            <Skeleton.Input
                active
                style={{
                    minHeight: 24,
                    margin: 0,
                    padding: 0,
                }}
            />
        </CellWrapper>
    )
}
