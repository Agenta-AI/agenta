import {memo, useMemo} from "react"

import {Clock} from "@phosphor-icons/react"
import clsx from "clsx"

import {Expandable} from "@/oss/components/Tables/ExpandableCell"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import useEvalRunScenarioData from "@/oss/lib/hooks/useEvaluationRunData/useEvalRunScenarioData"

import {titleCase} from "./flatDataSourceBuilder"
import TraceMetrics from "../../../AutoEvalRun/components/EvalRunScoreTable/assets/TraceMetrics"

type InvocationParamsEntry =
    | {
          requestBody?: {
              ag_config?: {
                  prompt?: {
                      messages?: Array<{role?: string; content?: string}>
                      template_format?: string
                      input_keys?: string[]
                      llm_config?: {
                          model?: string
                      }
                  }
              }
              inputs?: Record<string, unknown>
          }
      }
    | null
    | undefined

const getNestedValue = (root: any, path: string): any => {
    return path.split(".").reduce((acc, key) => {
        if (acc && typeof acc === "object") {
            return acc[key]
        }
        return undefined
    }, root as any)
}

const takeFirstNumber = (values: Array<number | string | undefined | null>): number | undefined => {
    for (const value of values) {
        if (typeof value === "number" && !Number.isNaN(value)) return value
        if (typeof value === "string") {
            const parsed = Number(value)
            if (!Number.isNaN(parsed)) return parsed
        }
    }
    return undefined
}

const normaliseText = (value: unknown): string => {
    if (value === null || value === undefined) return ""
    if (typeof value === "string") return value
    if (typeof value === "number" || typeof value === "boolean") return String(value)
    try {
        return JSON.stringify(value, null, 2)
    } catch (error) {
        return String(value)
    }
}

const ScenarioTraceSummary = ({
    scenarioId,
    stepKey,
    runId,
    trace,
    status,
    className,
}: {
    scenarioId: string
    stepKey: string
    runId?: string
    trace?: any
    status?: {status?: string}
    className?: string
}) => {
    const scenarioData = useEvalRunScenarioData(scenarioId, runId)

    const invocationStep = useMemo(() => {
        const steps = scenarioData?.invocationSteps ?? []
        if (!steps.length) return undefined
        if (!stepKey) return steps[0]
        return steps.find((step) => step.stepKey === stepKey) ?? steps[0]
    }, [scenarioData?.invocationSteps, stepKey])

    const invocationParams = useMemo<InvocationParamsEntry>(() => {
        const stepKeyEntry = invocationStep?.stepKey
        const scopedParams =
            invocationStep?.invocationParameters ?? scenarioData?.invocationParameters
        if (stepKeyEntry && scopedParams && stepKeyEntry in scopedParams) {
            return scopedParams[stepKeyEntry]
        }
        if (scopedParams) {
            const firstEntry = Object.values(scopedParams).find(Boolean)
            if (firstEntry) return firstEntry as InvocationParamsEntry
        }
        return undefined
    }, [
        invocationStep?.invocationParameters,
        invocationStep?.stepKey,
        scenarioData?.invocationParameters,
    ])

    const promptMessages = useMemo(() => {
        const messages = invocationParams?.requestBody?.ag_config?.prompt?.messages
        if (!Array.isArray(messages)) return []
        return messages.filter((msg) => !!msg && normaliseText(msg.content).trim().length > 0)
    }, [invocationParams])

    const promptText = useMemo(() => {
        if (!promptMessages.length) return ""
        return promptMessages
            .map((msg) => {
                const role = msg.role ? titleCase(msg.role) : "Message"
                const content = normaliseText(msg.content)
                return `${role}\n${content}`
            })
            .join("\n\n")
    }, [promptMessages])

    const inputEntries = useMemo(() => {
        const entries: Array<{key: string; value: string}> = []
        const inputs = invocationParams?.requestBody?.inputs
        if (inputs && typeof inputs === "object") {
            Object.entries(inputs).forEach(([key, value]) => {
                const textValue = normaliseText(value).trim()
                entries.push({
                    key,
                    value: textValue.length > 0 ? textValue : "—",
                })
            })
        }
        return entries
    }, [invocationParams])

    const modelName =
        invocationParams?.requestBody?.ag_config?.prompt?.llm_config?.model ||
        getNestedValue(trace, "otel.attributes.llm.request.model") ||
        getNestedValue(trace, "otel.attributes.llm.model") ||
        getNestedValue(trace, "otel.attributes.model")

    const templateFormat = invocationParams?.requestBody?.ag_config?.prompt?.template_format

    const startedAt =
        invocationStep?.createdAt ||
        invocationStep?.timestamp ||
        getNestedValue(trace, "time.start")

    const latencySeconds = takeFirstNumber([
        getNestedValue(trace, "metrics.duration.cumulative"),
        getNestedValue(trace, "metrics.duration.total"),
        getNestedValue(trace, "metrics.duration"),
        typeof invocationStep?.interval === "number" ? invocationStep.interval / 1000 : undefined,
        (() => {
            const start = getNestedValue(trace, "time.start")
            const end = getNestedValue(trace, "time.end")
            if (start && end) {
                const delta = dayjs(end).diff(dayjs(start), "second", true)
                return Number.isFinite(delta) ? delta : undefined
            }
            return undefined
        })(),
    ])

    const totalCost = takeFirstNumber([
        getNestedValue(trace, "metrics.costs.cumulative.total"),
        getNestedValue(trace, "metrics.cost.total"),
        getNestedValue(trace, "metrics.cost"),
        getNestedValue(trace, "data.metrics.costs.cumulative.total"),
        getNestedValue(trace, "data.costs.cumulative.total"),
        getNestedValue(trace, "attributes.ag.metrics.costs.cumulative.total"),
        getNestedValue(trace, "otel.attributes.ag.metrics.costs.cumulative.total"),
    ])

    const totalTokens = takeFirstNumber([
        getNestedValue(trace, "metrics.tokens.cumulative.total"),
        getNestedValue(trace, "metrics.tokens.total"),
        getNestedValue(trace, "metrics.tokens"),
        getNestedValue(trace, "data.metrics.tokens.cumulative.total"),
        getNestedValue(trace, "attributes.ag.metrics.tokens.cumulative.total"),
        getNestedValue(trace, "otel.attributes.ag.metrics.tokens.cumulative.total"),
    ])

    const statusLabel = useMemo(() => {
        const raw = status?.status || invocationStep?.status
        if (!raw) return undefined
        return titleCase(raw.replace(/_/g, " "))
    }, [status?.status, invocationStep?.status])

    const hasMetrics = [latencySeconds, totalCost, totalTokens].some(
        (value) => typeof value === "number" && !Number.isNaN(value),
    )

    const hasAnyDetails =
        Boolean(trace) ||
        Boolean(statusLabel) ||
        Boolean(modelName) ||
        Boolean(templateFormat) ||
        Boolean(startedAt) ||
        hasMetrics ||
        promptText.length > 0 ||
        inputEntries.length > 0

    if (!hasAnyDetails) return null

    const formattedStartedAt = startedAt ? dayjs(startedAt).format("MMM D, YYYY HH:mm:ss") : null

    return (
        <div
            className={clsx(
                "flex w-full flex-col gap-2 rounded-md border border-gray-200 bg-white/70 p-3 text-xs text-gray-600 shadow-[0_1px_3px_rgba(15,23,42,0.05)]",
                className,
            )}
        >
            {(statusLabel || modelName || templateFormat) && (
                <div className="flex flex-wrap items-center gap-2">
                    {statusLabel ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
                            Status
                            <span className="font-medium text-gray-900">{statusLabel}</span>
                        </span>
                    ) : null}
                    {modelName ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
                            Model
                            <span className="font-medium text-gray-900">{modelName}</span>
                        </span>
                    ) : null}
                    {templateFormat ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-semibold text-gray-600">
                            Template
                            <span className="font-medium uppercase text-gray-900">
                                {templateFormat}
                            </span>
                        </span>
                    ) : null}
                </div>
            )}

            {(formattedStartedAt || hasMetrics) && (
                <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                    {formattedStartedAt ? (
                        <span className="inline-flex items-center gap-1 font-medium">
                            <Clock size={12} />
                            {formattedStartedAt}
                        </span>
                    ) : null}
                    {hasMetrics ? (
                        <TraceMetrics
                            latency={latencySeconds ?? 0}
                            cost={totalCost ?? 0}
                            tokens={totalTokens ?? 0}
                        />
                    ) : null}
                </div>
            )}
            {!hasMetrics && !formattedStartedAt && trace ? (
                <span className="text-[11px] text-gray-500">
                    Trace captured. Use focus view to inspect the full execution.
                </span>
            ) : null}

            {inputEntries.length > 0 ? (
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Inputs
                    </span>
                    <Expandable expandKey={`${scenarioId}-${stepKey}-trace-inputs`}>
                        <div className="flex flex-wrap gap-1.5">
                            {inputEntries.map((entry) => (
                                <span
                                    key={`${entry.key}-${entry.value}`}
                                    className="max-w-[240px] truncate rounded border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700"
                                    title={`${entry.key}: ${entry.value}`}
                                >
                                    <span className="mr-1 uppercase tracking-wide text-gray-400">
                                        {entry.key}
                                    </span>
                                    <span className="text-gray-800">{entry.value}</span>
                                </span>
                            ))}
                        </div>
                    </Expandable>
                </div>
            ) : null}

            {promptText ? (
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        Prompt
                    </span>
                    <Expandable
                        expandKey={`${scenarioId}-${stepKey}-trace-prompt`}
                        className="[&_pre]:!text-xs"
                    >
                        <pre className="whitespace-pre-wrap rounded border border-gray-200 bg-gray-50 px-2 py-2 text-left text-[12px] text-gray-800">
                            {promptText}
                        </pre>
                    </Expandable>
                </div>
            ) : null}
        </div>
    )
}

export default memo(ScenarioTraceSummary)
