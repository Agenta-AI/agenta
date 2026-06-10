/**
 * Boundary adapters for the tracing migration (AGE-3788).
 *
 * The new Fern endpoints return the canonical `TraceOutput` tree, whose `spans`
 * field is the SAME recursive span-name map (`Record<spanName, Node | Node[]>`)
 * that `traceSpanSchema` / `buildTree` already consume. So these adapters only
 * normalise the OUTER ENVELOPE; the tree-building is reused, not rewritten.
 *
 *   /traces/{id}     -> TraceResponse  {trace}        -> fernTraceOutputToNodes
 *   /traces/query    -> TracesResponse {traces:[]}    -> fernTracesToLegacyTraceMap (transitional)
 *   /spans/query     -> SpansResponse  {spans:[]}     -> fernSpansToNodes
 *
 * All three are transitional: Phase 7 moves consumers onto the Fern tree
 * directly and deletes the legacy-map bridge (`fernTracesToLegacyTraceMap`).
 */
import type {TraceOutput, TraceSpan, TraceSpanNode, TracesResponse} from "../core"

import {transformTracesResponseToTree, transformTracingResponse} from "./helpers"

/** Strip dashes from a trace id to match the canonical (undashed) key form. */
const canonicalTraceId = (id: string): string => id.replace(/-/g, "")

/**
 * `GET /traces/{id}` (`TraceResponse.trace`) -> enriched `TraceSpanNode[]`.
 *
 * Wraps the single `TraceOutput` into the legacy envelope shape and reuses the
 * existing `transformTracesResponseToTree` + `transformTracingResponse`
 * pipeline (identical to what the observability/drawer consumers already do).
 */
export function fernTraceOutputToNodes(trace: TraceOutput | null | undefined): TraceSpanNode[] {
    if (!trace?.spans) return []
    const legacyEnvelope: TracesResponse = {
        count: 1,
        traces: {
            [canonicalTraceId(trace.trace_id ?? "trace")]: {
                spans: trace.spans as TracesResponse["traces"][string]["spans"],
            },
        },
    }
    return transformTracingResponse(transformTracesResponseToTree(legacyEnvelope))
}

/**
 * `POST /traces/query` (`TracesResponse.traces: TraceOutput[]`) -> the legacy
 * map-shaped `{count, traces: {[traceIdNoDashes]: {spans}}}`.
 *
 * TRANSITIONAL (Phase 5): `traceBatchFetcher` coalesces per-atom single-trace
 * reads, strips dashes, and slices a per-request `{count, traces:{[idNoDashes]:...}}`
 * out of this map. Keying by the undashed id keeps that coalescer + its
 * consumers (`traceEntityAtomFamily`) byte-identical. Deleted in Phase 7.
 */
export function fernTracesToLegacyTraceMap(
    traces: TraceOutput[] | null | undefined,
): TracesResponse {
    const out: TracesResponse["traces"] = {}
    for (const trace of traces ?? []) {
        if (!trace?.trace_id) continue
        out[canonicalTraceId(trace.trace_id)] = {
            spans: (trace.spans ?? {}) as TracesResponse["traces"][string]["spans"],
        }
    }
    return {count: Object.keys(out).length, traces: out}
}

/**
 * `POST /spans/query` flat `spans: TraceSpan[]` -> enriched `TraceSpanNode[]`.
 *
 * Flat spans form no tree (no `spans` children), so each maps to a leaf node;
 * `transformTracingResponse` adds `key`/`invocationIds` for rendering.
 */
export function fernSpansToNodes(spans: TraceSpan[] | null | undefined): TraceSpanNode[] {
    if (!spans?.length) return []
    return transformTracingResponse(spans as TraceSpanNode[])
}

// NOTE: the ETL pipeline (`evaluationRun/etl/hydrateScenariosTransform.ts`) and
// `resolveMappings.ts` consume the legacy MAP shape `data.traces[idNoDashes].spans`
// (verified), which `fernTracesToLegacyTraceMap` already produces — so no
// separate root-name-map adapter is needed.
