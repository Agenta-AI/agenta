import {useMemo} from "react"

import {toolStepsFromTrace} from "@agenta/chat/value-view"
import {canViewSpansAtom} from "@agenta/entities/access"
import type {TraceSpan} from "@agenta/entities/trace"
import {traceDrawerQueryOptions} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {
    isFailedStatus,
    isTerminalScenarioStatus,
    type ScenarioRow,
} from "../scenarios/scenarioColumns"

/**
 * The app call's trace of a test case, read once the call has finished (never while it runs, and
 * not for a call that failed). It is the trace drawer's own query, so opening the trace afterwards
 * sends no second request. Gives the tool calls of each user turn and the root span.
 */
export function useScenarioTrace(row: ScenarioRow) {
    const projectId = useAtomValue(projectIdAtom)
    const canViewSpans = useAtomValue(canViewSpansAtom)
    const invocation = row.invocation
    const traceId =
        invocation?.traceId &&
        isTerminalScenarioStatus(invocation.status) &&
        !isFailedStatus(invocation.status)
            ? invocation.traceId
            : null
    const query = useQuery(traceDrawerQueryOptions({traceId, projectId, canViewSpans}))
    const data = traceId ? query.data : undefined
    const turns = useMemo(() => toolStepsFromTrace(data), [data])
    const root = useMemo((): TraceSpan | null => {
        for (const entry of Object.values(data?.traces ?? {})) {
            const [first] = Object.values(entry.spans ?? {})
            if (first) return first
        }
        return null
    }, [data])
    const enabled = Boolean(traceId) && canViewSpans

    return {
        traceId,
        turns,
        toolCallCount: turns.reduce((sum, turn) => sum + turn.steps.length, 0),
        root,
        loading: enabled && query.isPending,
        // The trace API answers null when the read failed.
        failed: enabled && (query.isError || (query.isSuccess && data === null)),
        retry: () => void query.refetch(),
    }
}
