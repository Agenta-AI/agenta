/**
 * Agenta TypeScript SDK — Annotations manager.
 *
 * Annotations are stored as SimpleTraces via `/simple/traces/`.
 * This matches how Agenta's own frontend creates annotations
 * (web/oss/src/services/annotations/api/index.ts).
 *
 * The `/preview/annotations/` endpoint also exists but the Agenta
 * observability UI reads annotations through `/simple/traces/`, so
 * we use that endpoint for compatibility.
 *
 * Endpoints:
 *   POST   /simple/traces/              → create
 *   GET    /simple/traces/:traceId      → getByTrace
 *   PATCH  /simple/traces/:traceId      → editByTrace
 *   DELETE /simple/traces/:traceId      → deleteByTrace
 *   POST   /simple/traces/query         → query
 */

import type {AgentaClient} from "./client"
import type {
    Annotation,
    AnnotationCreate,
    AnnotationEdit,
    AnnotationQuery,
    AnnotationResponse,
    AnnotationsResponse,
    Windowing,
} from "./types"

export class Annotations {
    constructor(private readonly client: AgentaClient) {}

    /**
     * Create an annotation on a trace.
     *
     * Uses POST /simple/traces/ with { trace: payload } envelope,
     * matching Agenta's own frontend annotation service.
     */
    async create(annotation: AnnotationCreate): Promise<AnnotationResponse> {
        const res = await this.client.post<{count?: number; trace?: Annotation}>(
            "/simple/traces/",
            {trace: annotation},
        )
        return {
            count: res.count ?? (res.trace ? 1 : 0),
            annotation: res.trace,
        }
    }

    /**
     * Get annotation by trace ID, optionally scoped to a specific span.
     *
     * When spanId is provided, uses the query endpoint with links
     * to find annotations for that specific span.
     * Without spanId, fetches annotations for the root span.
     */
    async getByTrace(traceId: string, spanId?: string): Promise<AnnotationResponse> {
        if (spanId) {
            // Span-level lookup: query with annotation_links
            const res = await this.query({
                annotationLinks: [{trace_id: traceId, span_id: spanId}],
            })
            return {
                count: res.count,
                annotation: res.annotations[0],
            }
        }

        const res = await this.client.get<{count?: number; trace?: Annotation}>(
            `/simple/traces/${traceId}`,
        )
        return {
            count: res.count ?? (res.trace ? 1 : 0),
            annotation: res.trace,
        }
    }

    /**
     * Edit an annotation by trace ID.
     */
    async editByTrace(traceId: string, annotation: AnnotationEdit): Promise<AnnotationResponse> {
        const res = await this.client.request<{
            count?: number
            trace?: Annotation
        }>("PATCH", `/simple/traces/${traceId}`, {
            body: {trace: annotation},
        })
        return {
            count: res.count ?? (res.trace ? 1 : 0),
            annotation: res.trace,
        }
    }

    /**
     * Delete annotation by trace ID, optionally scoped to a specific span.
     */
    async deleteByTrace(traceId: string, spanId?: string): Promise<void> {
        if (spanId) {
            // Span-level delete via /preview/annotations/{traceId}/{spanId}
            await this.client.request("DELETE", `/preview/annotations/${traceId}/${spanId}`)
        } else {
            await this.client.request("DELETE", `/simple/traces/${traceId}`)
        }
    }

    /**
     * Query annotations.
     *
     * Maps annotation query params to simple/traces query format:
     *   annotation_links → links
     *   annotation → trace
     */
    async query(options?: {
        annotation?: AnnotationQuery
        annotationLinks?: {trace_id: string; span_id?: string}[]
        windowing?: Windowing
    }): Promise<AnnotationsResponse> {
        const body: Record<string, unknown> = {}
        if (options?.annotationLinks) {
            body.links = options.annotationLinks
        }
        if (options?.annotation) {
            body.trace = options.annotation
        }
        if (options?.windowing) {
            body.windowing = options.windowing
        }

        const res = await this.client.post<{
            count?: number
            traces?: Annotation[]
        }>("/simple/traces/query", body)

        return {
            count: res.count ?? res.traces?.length ?? 0,
            annotations: res.traces ?? [],
        }
    }

    /**
     * Get all annotations for a set of trace IDs.
     */
    async getForTraces(traceIds: string[]): Promise<Annotation[]> {
        const res = await this.query({
            annotationLinks: traceIds.map((id) => ({trace_id: id})),
        })
        return res.annotations
    }

    /**
     * Resolve the root span ID for a trace.
     *
     * Agenta requires both trace_id AND span_id in annotation links.
     * If span_id isn't known, fetch the trace and find the root span.
     */
    /**
     * Resolve the root span ID for a trace.
     *
     * Uses GET /preview/tracing/traces/{traceId} — the same endpoint
     * that Agenta's own frontend uses in `fetchPreviewTrace`.
     *
     * Response shape: { traces: { <traceKey>: { spans: { <spanId>: { span_id, parent_id, ... } } } } }
     */
    private async resolveSpanId(traceId: string, spanId?: string): Promise<string | undefined> {
        if (spanId) return spanId

        try {
            // GET /preview/tracing/traces/{traceId} — matches Agenta's fetchPreviewTrace
            const traceData = await this.client.get<Record<string, unknown>>(
                `/tracing/traces/${traceId}`,
            )

            const traces = traceData?.traces as Record<string, unknown> | undefined
            if (!traces) return undefined

            // Trace key may be with or without dashes
            const traceKey = traceId.replace(/-/g, "")
            const traceEntry = (traces[traceKey] ?? traces[traceId]) as
                | Record<string, unknown>
                | undefined
            if (!traceEntry) return undefined

            const spans = traceEntry.spans as Record<string, unknown> | undefined
            if (!spans) return undefined

            // Find root span (no parent_id), fallback to first span
            for (const span of Object.values(spans)) {
                const s = span as Record<string, unknown>
                if (!s.parent_id && s.span_id) {
                    return s.span_id as string
                }
            }

            const firstSpan = Object.values(spans)[0] as Record<string, unknown> | undefined
            return firstSpan?.span_id as string | undefined
        } catch {
            return undefined
        }
    }

    /**
     * Create a human feedback annotation linked to an evaluator.
     *
     * Matches Agenta's own frontend annotation flow:
     * - Uses `/simple/traces/` (not `/preview/annotations/`)
     * - Wraps outputs in `data.outputs` (not flat data)
     * - Resolves span_id from trace if not provided
     * - Uses `"invocation"` as the links key
     */
    async createHumanFeedback(options: {
        evaluatorId: string
        evaluatorSlug: string
        evaluatorRevisionId?: string
        evaluatorName?: string
        invocationTraceId: string
        invocationSpanId?: string
        outputs: Record<string, unknown>
        outputKeys?: string[]
    }): Promise<AnnotationResponse> {
        const spanId = await this.resolveSpanId(options.invocationTraceId, options.invocationSpanId)

        return this.create({
            origin: "human",
            kind: "adhoc",
            channel: "web",
            data: {
                outputs: options.outputs,
            },
            references: {
                evaluator: {id: options.evaluatorId, slug: options.evaluatorSlug},
                ...(options.evaluatorRevisionId
                    ? {evaluator_revision: {id: options.evaluatorRevisionId}}
                    : {}),
            },
            links: {
                invocation: {
                    trace_id: options.invocationTraceId,
                    span_id: spanId,
                },
            },
            meta: {
                name: options.evaluatorName ?? "Human Feedback",
                tags: options.outputKeys ?? Object.keys(options.outputs),
            },
        })
    }
}
