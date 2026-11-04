import {useMemo} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {executionItemController} from "@agenta/playground"
import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"
import {atom, useAtomValue} from "jotai"

export interface RevisionRunAverages {
    latency: string
    tokens: string
    cost: string
}

const EMPTY: RevisionRunAverages = {latency: "-", tokens: "-", cost: "-"}

/**
 * The average latency, tokens and cost of a revision's latest run on each test case, as the
 * variant card shows them. The numbers come from each run's trace, the same source as the
 * line under each output; with repeats the last repeat counts. "-" until a trace reports them,
 * and for a reader who may not view traces.
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
                    const result = get(
                        executionItemController.selectors.fullResult({
                            rowId,
                            entityId: revisionId,
                        }),
                    )
                    const traceId = result?.repetitions?.at(-1)?.traceId ?? result?.traceId
                    if (!traceId) continue
                    const {metrics} = get(traceDataSummaryAtomFamily(traceId))
                    if (metrics.durationMs === undefined) continue
                    duration += metrics.durationMs
                    cost += metrics.totalCost ?? 0
                    tokens += metrics.totalTokens ?? 0
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
