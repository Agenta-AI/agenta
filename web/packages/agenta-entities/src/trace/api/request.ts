/**
 * Request builders for the tracing API (AGE-3788).
 *
 * Single home for translating the legacy `TraceQueryParams` shape into the
 * Fern request objects, replacing the param-transform reducer that was
 * copy-pasted across three functions. Keeping it here also gives one place to
 * evolve the freeform-filter -> structured `FilteringInput` translation
 * (OQ1, finalised in Phase 4).
 */
import type {AgentaApi} from "@agentaai/api-client"

/** Legacy query params accepted by the pre-migration trace api functions. */
export interface TraceQueryParams {
    size?: number
    /**
     * Retained for source compatibility. The new `/spans/query` endpoint
     * always returns FLAT spans (focus="trace" => 409), so `buildSpansQueryRequest`
     * intentionally ignores `focus`. Trace-tree callers use `queryTraces`
     * (`/traces/query`) instead.
     */
    focus?: "trace" | "span" | "chat"
    format?: string
    filter?: string | Record<string, unknown>
    oldest?: string
    newest?: string
    cursor?: string
    order?: AgentaApi.Windowing.Order
    [key: string]: unknown
}

/**
 * Parse the legacy `filter` param (freeform JSON string OR already-structured
 * object) into a Fern `FilteringInput`.
 *
 * The batch fetchers already pass a structured `{conditions:[{field,operator,value}]}`
 * object, which maps directly. Freeform string filters are JSON-parsed.
 *
 * OQ1: the observability filter UI (Phase 4) may produce freeform shapes whose
 * operators don't map 1:1 onto Fern's structured operators — that translation
 * is finalised when Phase 4 wires the filter UI. Until then this passes
 * structured input through and parses JSON strings.
 */
export function toFilteringInput(
    filter: string | Record<string, unknown> | undefined,
): AgentaApi.FilteringInput | undefined {
    if (filter === undefined || filter === null) return undefined
    let parsed: unknown = filter
    if (typeof filter === "string") {
        try {
            parsed = JSON.parse(filter)
        } catch {
            // Not JSON — nothing structured we can send; drop it.
            return undefined
        }
    }
    if (typeof parsed !== "object" || parsed === null) return undefined
    // Already FilteringInput-shaped ({operator?, conditions[]}).
    return parsed as AgentaApi.FilteringInput
}

/**
 * Shared windowing + filtering body. `SpansQueryRequest` and `TracesQueryRequest`
 * are structurally identical ({filtering, windowing, query_*_ref}), so both
 * builders share this and only differ in their nominal return type.
 */
function buildWindowAndFilter(params: TraceQueryParams): {
    windowing?: AgentaApi.Windowing
    filtering?: AgentaApi.FilteringInput
} {
    const windowing: AgentaApi.Windowing = {}
    if (params.size !== undefined) windowing.limit = Number(params.size)
    if (params.cursor) windowing.next = params.cursor
    if (params.oldest) windowing.oldest = params.oldest
    if (params.newest) windowing.newest = params.newest
    if (params.order) windowing.order = params.order

    const out: {windowing?: AgentaApi.Windowing; filtering?: AgentaApi.FilteringInput} = {}
    if (Object.keys(windowing).length > 0) out.windowing = windowing
    const filtering = toFilteringInput(params.filter)
    if (filtering) out.filtering = filtering
    return out
}

/**
 * Map legacy `TraceQueryParams` -> Fern `SpansQueryRequest` for `POST /spans/query`.
 * Pagination/time range ride `windowing` (cursor-only via `windowing.next`).
 */
export function buildSpansQueryRequest(params: TraceQueryParams = {}): AgentaApi.SpansQueryRequest {
    return buildWindowAndFilter(params)
}

/**
 * Map legacy `TraceQueryParams` -> Fern `TracesQueryRequest` for `POST /traces/query`
 * (the trace-tree path; a trace matches when any span matches the filter).
 */
export function buildTracesQueryRequest(
    params: TraceQueryParams = {},
): AgentaApi.TracesQueryRequest {
    return buildWindowAndFilter(params)
}
