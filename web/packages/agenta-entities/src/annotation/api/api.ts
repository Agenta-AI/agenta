/**
 * Annotation API Functions
 *
 * HTTP API functions for Annotation entities backed by `simple/traces`.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/preview/simple/traces/`
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared"
import {annotationSchema, type Annotation, type AnnotationsResponse} from "../core"
import type {
    AnnotationDetailParams,
    AnnotationQueryParams,
    CreateAnnotationPayload,
    UpdateAnnotationPayload,
} from "../core"

const simpleTraceResponseSchema = z.object({
    count: z.number().optional().default(0),
    trace: annotationSchema.nullable().optional(),
})

const simpleTracesResponseSchema = z.object({
    count: z.number().optional().default(0),
    traces: z.array(annotationSchema).default([]),
})

// ============================================================================
// CREATE
// ============================================================================

/**
 * Create a new annotation.
 *
 * Endpoint: `POST /preview/simple/traces/`
 */
export async function createAnnotation(
    projectId: string,
    payload: CreateAnnotationPayload,
): Promise<Annotation | null> {
    if (!projectId) return null

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/simple/traces/`,
        {trace: payload},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleTraceResponseSchema,
        response.data,
        "[createAnnotation]",
    )
    return validated?.trace ?? null
}

// ============================================================================
// FETCH (Single)
// ============================================================================

/**
 * Fetch all annotations for a specific trace/span pair.
 *
 * Uses `POST /preview/simple/traces/query` because multiple annotation traces
 * can exist per invocation trace/span pair.
 */
export async function fetchAnnotation({
    projectId,
    traceId,
    spanId,
}: AnnotationDetailParams): Promise<AnnotationsResponse> {
    if (!projectId || !traceId) {
        return {count: 0, annotations: []}
    }

    const link: {trace_id: string; span_id?: string} = {trace_id: traceId}
    if (spanId) {
        link.span_id = spanId
    }

    return queryAnnotations({
        projectId,
        annotationLinks: [link],
    })
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Update an existing annotation.
 *
 * Endpoint: `PATCH /preview/simple/traces/{traceId}/{spanId}`
 */
export async function updateAnnotation(
    projectId: string,
    traceId: string,
    spanId: string | undefined,
    payload: UpdateAnnotationPayload,
): Promise<Annotation | null> {
    if (!projectId || !traceId) return null

    const path = `${getAgentaApiUrl()}/preview/simple/traces/${traceId}`

    const response = await axios.patch(
        path,
        {trace: payload.annotation},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        simpleTraceResponseSchema,
        response.data,
        "[updateAnnotation]",
    )
    return validated?.trace ?? null
}

// ============================================================================
// DELETE
// ============================================================================

/**
 * Delete an annotation.
 *
 * Endpoint: `DELETE /preview/simple/traces/{traceId}/{spanId}`
 */
export async function deleteAnnotation(
    projectId: string,
    traceId: string,
    spanId?: string,
): Promise<void> {
    if (!projectId || !traceId) return

    const path = `${getAgentaApiUrl()}/preview/simple/traces/${traceId}`

    await axios.delete(path, {
        params: {project_id: projectId},
    })
}

// ============================================================================
// QUERY (Batch)
// ============================================================================

/**
 * Query annotations by trace/span links or annotation filters.
 *
 * Endpoint: `POST /preview/simple/traces/query`
 *
 * This wrapper keeps annotation-oriented naming for callers while translating
 * request/response envelopes to the backend `simple/traces` contract. Callers can:
 * - pass `annotationLinks` with `{trace_id, span_id}` pairs, or
 * - pass an `annotation` filter object, such as `references.testcase.id`
 */
export async function queryAnnotations({
    projectId,
    annotationLinks,
    annotation,
    windowing,
}: AnnotationQueryParams): Promise<AnnotationsResponse> {
    const hasLinks = (annotationLinks?.length ?? 0) > 0
    const hasAnnotationFilter = !!annotation

    if (!projectId || (!hasLinks && !hasAnnotationFilter)) {
        return {count: 0, annotations: []}
    }

    const body: Record<string, unknown> = {}
    if (hasLinks) {
        body.links = annotationLinks
    }
    if (annotation) {
        body.trace = annotation
    }
    if (windowing) {
        body.windowing = windowing
    }

    const response = await axios.post(`${getAgentaApiUrl()}/preview/simple/traces/query`, body, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        simpleTracesResponseSchema,
        response.data,
        "[queryAnnotations]",
    )
    return {
        count: validated?.count ?? 0,
        annotations: validated?.traces ?? [],
    }
}

export async function queryAnnotationsByInvocationLink({
    projectId,
    traceId,
    spanId,
}: {
    projectId: string
    traceId: string
    spanId?: string
}): Promise<AnnotationsResponse> {
    if (!projectId || !traceId) {
        return {count: 0, annotations: []}
    }

    // Step 1: Find annotation spans that link to the invocation trace_id.
    // The links column stores marshalled OTelLink objects like:
    //   {"trace_id": "uuid", "span_id": "hex16", "attributes.key": "invocation"}
    // PostgreSQL @> containment matches partial objects, so matching on trace_id alone works.
    const spansBody = {
        filtering: {
            operator: "and",
            conditions: [
                // Only annotation traces
                {
                    field: "attributes",
                    key: "ag.type.trace",
                    value: "annotation",
                    operator: "is",
                },
                // Links contain the invocation trace_id
                {
                    field: "links",
                    operator: "in",
                    value: [{trace_id: traceId}],
                },
            ],
        },
    }

    const spansResponse = await axios.post(`${getAgentaApiUrl()}/preview/spans/query`, spansBody, {
        params: {project_id: projectId},
    })

    const spans = spansResponse.data?.spans ?? []
    if (spans.length === 0) {
        return {count: 0, annotations: []}
    }

    // Step 2: Extract annotation trace_ids and fetch full annotation data
    const annotationTraceIds: {trace_id: string}[] = []
    const seen = new Set<string>()
    for (const span of spans) {
        const tid = span.trace_id
        if (tid && !seen.has(tid)) {
            seen.add(tid)
            annotationTraceIds.push({trace_id: tid})
        }
    }

    if (annotationTraceIds.length === 0) {
        return {count: 0, annotations: []}
    }

    return queryAnnotations({
        projectId,
        annotationLinks: annotationTraceIds,
    })
}
