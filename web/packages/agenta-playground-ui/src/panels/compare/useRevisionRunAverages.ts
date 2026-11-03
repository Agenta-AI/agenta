import {useMemo} from "react"

import {executionItemController} from "@agenta/playground"
import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"
import {atom, useAtomValue} from "jotai"

interface RunMetrics {
    duration?: {total?: number}
    costs?: {total?: number}
    tokens?: {total?: number}
}

/** The metrics of a run's root span, summed over its children when the span has them. */
const metricsOf = (output: unknown): RunMetrics | null => {
    const node = (output as {response?: {tree?: {nodes?: {metrics?: Record<string, unknown>}[]}}})
        ?.response?.tree?.nodes?.[0]
    return ((node?.metrics?.acc ?? node?.metrics?.unit) as RunMetrics | undefined) ?? null
}

export interface RevisionRunAverages {
    latency: string
    tokens: string
    cost: string
}

const EMPTY: RevisionRunAverages = {latency: "-", tokens: "-", cost: "-"}

/**
 * The average latency, tokens and cost of a revision's latest run on each test case, as the
 * variant card shows them. "-" before any run that reported metrics.
 */
export const useRevisionRunAverages = (revisionId: string): RevisionRunAverages => {
    const averages = useMemo(
        () =>
            atom((get) => {
                const rowIds = get(executionItemController.selectors.executionRowIds) as string[]
                let duration = 0
                let cost = 0
                let tokens = 0
                let count = 0
                for (const rowId of rowIds) {
                    const output = get(
                        executionItemController.selectors.fullResult({
                            rowId,
                            entityId: revisionId,
                        }),
                    )?.output as unknown
                    // With repeats the output is a list: the last repeat counts.
                    const metrics = metricsOf(Array.isArray(output) ? output.at(-1) : output)
                    if (!metrics) continue
                    duration += Number(metrics.duration?.total ?? 0)
                    cost += Number(metrics.costs?.total ?? 0)
                    tokens += Number(metrics.tokens?.total ?? 0)
                    count += 1
                }
                if (count === 0) return EMPTY
                return {
                    latency: formatLatency(duration / count / 1000),
                    tokens: formatTokenUsage(tokens / count),
                    cost: formatCurrency(cost / count),
                }
            }),
        [revisionId],
    )
    return useAtomValue(averages)
}
