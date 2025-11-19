import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import type {TraceData, TraceNode} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"

import {resolveInvocationTraceValue} from "../utils/traceValue"

import {activePreviewRunIdAtom} from "./run"
import {scenarioStepsQueryFamily} from "./scenarioSteps"
import {evaluationRunIndexAtomFamily} from "./table/run"
import {traceQueryMetaAtomFamily, traceValueAtomFamily} from "./traces"

export interface InvocationTraceSummaryValue {
    state: "idle" | "loading" | "ready"
    traceId?: string
    status?: string
    durationMs?: number
    totalTokens?: number
    totalCost?: number
    errorCount?: number
    promptTokens?: number
    completionTokens?: number
}

const toNumeric = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
    }
    return undefined
}

const extractTraceId = (step: any): string | undefined => {
    const direct = step?.traceId || step?.trace_id
    if (direct) return String(direct)
    const trace = step?.trace
    if (!trace) return undefined
    if (trace?.tree?.id) return String(trace.tree.id)
    if (Array.isArray(trace?.trees) && trace.trees[0]?.tree?.id)
        return String(trace.trees[0].tree.id)
    if (Array.isArray(trace?.nodes) && trace.nodes[0]?.trace_id)
        return String(trace.nodes[0].trace_id)
    return undefined
}

const getPrimaryTraceNode = (trace: TraceData | null | undefined): TraceNode | undefined => {
    if (!trace) return undefined

    const candidateTrees: {nodes?: TraceNode[]}[] = []
    if (Array.isArray((trace as any)?.trees)) {
        candidateTrees.push(...((trace as any).trees as {nodes?: TraceNode[]}[]))
    }
    if ((trace as any)?.tree) {
        candidateTrees.push((trace as any).tree)
    }
    if (Array.isArray((trace as any)?.nodes)) {
        const nodes = (trace as any).nodes as TraceNode[]
        return nodes.length ? nodes[0] : undefined
    }

    for (const tree of candidateTrees) {
        if (!tree?.nodes) continue
        if (Array.isArray(tree.nodes) && tree.nodes.length) {
            return tree.nodes[0]
        }
        if (tree.nodes && typeof tree.nodes === "object") {
            const first = Object.values(tree.nodes).find(Boolean)
            if (Array.isArray(first)) {
                return first.length ? (first[0] as TraceNode) : undefined
            }
            if (first && typeof first === "object") {
                return first as TraceNode
            }
        }
    }

    return undefined
}

const collectMetricSources = (node?: TraceNode | null): any[] => {
    if (!node) return []

    const sources: any[] = []
    const push = (value: any) => {
        if (!value) return
        if (sources.includes(value)) return
        sources.push(value)
    }

    push(node.metrics)
    push(node.metrics?.acc)
    push(node.metrics?.unit)
    push((node as any)?.data?.metrics)
    push((node as any)?.data?.attributes?.ag?.metrics)
    push((node as any)?.otel?.attributes?.metrics)

    return sources
}

export const invocationTraceSummaryAtomFamily = atomFamily(
    ({scenarioId, stepKey, runId}: {scenarioId?: string; stepKey?: string; runId?: string}) =>
        atom<InvocationTraceSummaryValue>((get) => {
            if (!scenarioId) return {state: "idle"}

            const effectiveRunId = runId ?? get(activePreviewRunIdAtom) ?? undefined
            const runIndex = get(
                evaluationRunIndexAtomFamily(effectiveRunId ? effectiveRunId : null),
            )

            const stepsQuery = get(scenarioStepsQueryFamily({scenarioId, runId: effectiveRunId}))
            if (stepsQuery.isLoading || stepsQuery.isFetching) {
                return {state: "loading"}
            }

            const allSteps = stepsQuery.data?.steps ?? []
            const candidateKeys: string[] = []
            if (stepKey) candidateKeys.push(stepKey)
            if (runIndex) {
                runIndex.invocationKeys.forEach((key) => {
                    if (!candidateKeys.includes(key)) candidateKeys.push(key)
                })
            }

            const invocationStep = candidateKeys
                .map((key) => allSteps.find((step: any) => step?.stepKey === key))
                .find((step) => step)

            if (!invocationStep) {
                return {state: "ready", status: undefined, traceId: undefined}
            }

            const traceId = extractTraceId(invocationStep)
            const trace = invocationStep.trace as TraceData | null | undefined
            const traceMeta = traceId
                ? get(traceQueryMetaAtomFamily({traceId, runId: effectiveRunId}))
                : undefined
            let traceLoading = false
            const primaryNode = getPrimaryTraceNode(trace)
            const metricSources = collectMetricSources(primaryNode)

            const readTraceMetric = (
                extract: (source: any, node?: TraceNode) => unknown,
                fallbackPaths: {path: string; valueKey?: string}[],
            ): number | undefined => {
                const fromNode = metricSources
                    .map((source) => toNumeric(extract(source, primaryNode)))
                    .find((value): value is number => value !== undefined)
                if (fromNode !== undefined) return fromNode

                for (const {path, valueKey} of fallbackPaths) {
                    const localValue = toNumeric(resolveInvocationTraceValue(trace, path, valueKey))
                    if (localValue !== undefined) return localValue
                }

                if (!traceId) return undefined

                for (const {path, valueKey} of fallbackPaths) {
                    const remoteValue = toNumeric(
                        get(
                            traceValueAtomFamily({
                                traceId,
                                path,
                                valueKey,
                                runId: effectiveRunId,
                            }),
                        ),
                    )
                    if (remoteValue !== undefined) return remoteValue
                }

                if (traceMeta?.isLoading || traceMeta?.isFetching) {
                    traceLoading = true
                }
                return undefined
            }

            const durationMs = readTraceMetric(
                (source) => source?.duration?.total ?? source?.duration,
                [
                    {path: "metrics.acc.duration.total"},
                    {path: "metrics.unit.duration.total"},
                    {path: "metrics.duration.total"},
                    {
                        path: "attributes.ag.metrics.duration.cumulative.total",
                        valueKey: "duration.total",
                    },
                    {path: "attributes.ag.metrics.duration.cumulative"},
                    {path: "duration.total"},
                ],
            )
            const totalTokens = readTraceMetric(
                (source) => source?.tokens?.total,
                [
                    {path: "metrics.acc.tokens.total"},
                    {path: "metrics.unit.tokens.total"},
                    {path: "metrics.tokens.total"},
                    {
                        path: "attributes.ag.metrics.tokens.cumulative.total",
                        valueKey: "tokens.total",
                    },
                    {path: "tokens.total"},
                ],
            )
            const promptTokens = readTraceMetric(
                (source) => source?.tokens?.prompt,
                [
                    {path: "metrics.acc.tokens.prompt"},
                    {path: "metrics.unit.tokens.prompt"},
                    {path: "metrics.tokens.prompt"},
                    {
                        path: "attributes.ag.metrics.tokens.prompt.total",
                        valueKey: "tokens.prompt",
                    },
                    {path: "tokens.prompt"},
                ],
            )
            const completionTokens = readTraceMetric(
                (source) => source?.tokens?.completion,
                [
                    {path: "metrics.acc.tokens.completion"},
                    {path: "metrics.unit.tokens.completion"},
                    {path: "metrics.tokens.completion"},
                    {
                        path: "attributes.ag.metrics.tokens.completion.total",
                        valueKey: "tokens.completion",
                    },
                    {path: "tokens.completion"},
                ],
            )
            const totalCost = readTraceMetric(
                (source) => source?.costs?.total ?? source?.cost?.total,
                [
                    {path: "metrics.acc.costs.total"},
                    {path: "metrics.unit.costs.total"},
                    {path: "metrics.costs.total"},
                    {
                        path: "attributes.ag.metrics.costs.cumulative.total",
                        valueKey: "costs.total",
                    },
                    {path: "costs.total"},
                ],
            )
            const errorCount = readTraceMetric(
                (source) =>
                    source?.errors?.total ??
                    source?.errors?.cumulative?.total ??
                    source?.error?.count,
                [
                    {path: "metrics.acc.errors.total"},
                    {path: "metrics.acc.errors.cumulative.total"},
                    {path: "metrics.errors.total"},
                    {path: "metrics.errors.cumulative.total"},
                    {
                        path: "attributes.ag.metrics.errors.cumulative.total",
                        valueKey: "errors",
                    },
                    {path: "errors.total"},
                ],
            )

            return {
                state: "ready",
                traceId,
                status: invocationStep.status,
                durationMs,
                totalTokens,
                promptTokens,
                completionTokens,
                totalCost,
                errorCount,
            }
        }),
)
