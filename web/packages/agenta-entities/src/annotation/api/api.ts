/**
 * Annotation API Functions
 *
 * HTTP API functions for Annotation entities.
 * These are pure functions with no Jotai dependencies.
 *
 * Base endpoint: `/preview/annotations/`
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {safeParseWithLogging} from "../../shared"
import {
    annotationResponseSchema,
    annotationsResponseSchema,
    type Annotation,
    type AnnotationsResponse,
} from "../core"
import type {
    AnnotationDetailParams,
    AnnotationQueryParams,
    CreateAnnotationPayload,
    UpdateAnnotationPayload,
} from "../core"

// ============================================================================
// CREATE
// ============================================================================

/**
 * Create a new annotation.
 *
 * Endpoint: `POST /preview/annotations/`
 */
export async function createAnnotation(
    projectId: string,
    payload: CreateAnnotationPayload,
): Promise<Annotation | null> {
    if (!projectId) return null

    const response = await axios.post(
        `${getAgentaApiUrl()}/preview/annotations/`,
        {annotation: payload},
        {params: {project_id: projectId}},
    )

    const validated = safeParseWithLogging(
        annotationResponseSchema,
        response.data,
        "[createAnnotation]",
    )
    return validated?.annotation ?? null
}

// ============================================================================
// FETCH (Single)
// ============================================================================

/**
 * Fetch all annotations for a specific trace/span pair.
 *
 * Uses `POST /preview/annotations/query` instead of the GET endpoint
 * because the GET returns a single `AnnotationResponse` (singular),
 * while multiple annotations can exist per trace/span (one per evaluator).
 * The query endpoint returns `AnnotationsResponse` (plural).
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
 * Endpoint: `PATCH /preview/annotations/{traceId}/{spanId}`
 */
export async function updateAnnotation(
    projectId: string,
    traceId: string,
    spanId: string | undefined,
    payload: UpdateAnnotationPayload,
): Promise<Annotation | null> {
    if (!projectId || !traceId) return null

    const path = spanId
        ? `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}`
        : `${getAgentaApiUrl()}/preview/annotations/${traceId}`

    const response = await axios.patch(path, payload, {params: {project_id: projectId}})

    const validated = safeParseWithLogging(
        annotationResponseSchema,
        response.data,
        "[updateAnnotation]",
    )
    return validated?.annotation ?? null
}

// ============================================================================
// DELETE
// ============================================================================

/**
 * Delete an annotation.
 *
 * Endpoint: `DELETE /preview/annotations/{traceId}/{spanId}`
 */
export async function deleteAnnotation(
    projectId: string,
    traceId: string,
    spanId?: string,
): Promise<void> {
    if (!projectId || !traceId) return

    const path = spanId
        ? `${getAgentaApiUrl()}/preview/annotations/${traceId}/${spanId}`
        : `${getAgentaApiUrl()}/preview/annotations/${traceId}`

    await axios.delete(path, {
        params: {project_id: projectId},
    })
}

// ============================================================================
// QUERY (Batch)
// ============================================================================

/**
 * Query annotations by trace/span links.
 *
 * Endpoint: `POST /preview/annotations/query`
 *
 * This is the primary batch fetching endpoint. Pass an array of
 * `{trace_id, span_id}` pairs and get back all matching annotations.
 */
export async function queryAnnotations({
    projectId,
    annotationLinks,
    windowing,
}: AnnotationQueryParams): Promise<AnnotationsResponse> {
    if (!projectId || annotationLinks.length === 0) {
        return {count: 0, annotations: []}
    }

    const body: Record<string, unknown> = {
        annotation_links: annotationLinks,
    }
    if (windowing) {
        body.windowing = windowing
    }

    const response = await axios.post(`${getAgentaApiUrl()}/preview/annotations/query`, body, {
        params: {project_id: projectId},
    })

    const validated = safeParseWithLogging(
        annotationsResponseSchema,
        response.data,
        "[queryAnnotations]",
    )
    return validated ?? {count: 0, annotations: []}
}

/**
 * Query annotations by their `links` field (i.e., find annotations that reference
 * a given invocation trace_id/span_id).
 *
 * This is a fallback for when annotation step results don't exist in the evaluation run,
 * allowing us to still find annotations linked to a scenario's invocation trace.
 *
 * Endpoint: `POST /preview/annotations/query`
 */
/**
 * Finds annotations linked to a given invocation trace.
 *
 * Two-step approach:
 * 1. Query spans table for annotation traces whose `links` JSONB contains the target trace_id
 *    (uses `/preview/spans/query` with JSONB containment — bypasses the annotation query path
 *    which has a marshalling format mismatch between stored and queried link data).
 * 2. Use the discovered annotation trace_ids to fetch full annotation data via `queryAnnotations`.
 */
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
