import {traceSpanSchema, type TraceSpan, type TraceSummarySpans} from "@agenta/entities/trace"
import type {QueryKey} from "@tanstack/react-query"

import type {StoryScope} from "../.storybook/decorators/withAgentaData"

/**
 * Fixture builders for the per-trace summary query
 * (`traceSummaryQueryAtomFamily` → trace/state/store.ts:767,
 * queryKey `["trace-summary", projectId, traceId]`).
 *
 * The root span is built through `traceSpanSchema` — the same zod schema the API
 * boundary validates spans with — so the fixture cannot drift from the contract
 * silently. Ids come from the story's `StoryScope` (L1 isolation).
 */

export interface TraceIds {
    projectId: string
    traceId: string
    spanId: string
}

export function traceIds(scope: StoryScope): TraceIds {
    return {
        projectId: scope.projectId,
        traceId: scope.id("trace"),
        spanId: scope.id("span"),
    }
}

/**
 * A root span with OK status, outputs, and cumulative metrics under
 * `attributes.ag` — read via the `ag.metrics.*.cumulative.*` paths in
 * `traceDataSummaryAtomFamily` (loadable/controller.ts:1795+).
 */
export function traceRootSpan(ids: TraceIds, overrides: Partial<TraceSpan> = {}): TraceSpan {
    return traceSpanSchema.parse({
        trace_id: ids.traceId,
        span_id: ids.spanId,
        span_name: "agent.run",
        start_time: "2026-01-01T00:00:00.000Z",
        end_time: "2026-01-01T00:00:04.200Z",
        status_code: "STATUS_CODE_OK",
        attributes: {
            ag: {
                data: {outputs: {answer: "42"}},
                metrics: {
                    duration: {cumulative: {total: 4200}},
                    tokens: {cumulative: {total: 1234, prompt: 1000, completion: 234}},
                    costs: {cumulative: {total: 0.0123}},
                },
            },
        },
        ...overrides,
    })
}

/** The `["trace-summary", projectId, traceId]` fixture entry. */
export function traceSummaryQueries(
    scope: StoryScope,
    opts?: {rootSpan?: (ids: TraceIds) => TraceSpan; errorSpans?: TraceSpan[]},
): [QueryKey, unknown][] {
    const ids = traceIds(scope)
    const summary: TraceSummarySpans = {
        rootSpan: opts?.rootSpan ? opts.rootSpan(ids) : traceRootSpan(ids),
        errorSpans: opts?.errorSpans ?? [],
    }
    // traceSummaryQueryAtomFamily → trace/state/store.ts:767
    return [[["trace-summary", ids.projectId, ids.traceId], summary]]
}
