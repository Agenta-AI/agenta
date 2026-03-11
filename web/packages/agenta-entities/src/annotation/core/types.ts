/**
 * Annotation API Parameter Types
 *
 * Interfaces for API function parameters.
 *
 * @packageDocumentation
 */

// ============================================================================
// QUERY PARAMETERS
// ============================================================================

/**
 * A single trace/span link for batch annotation queries.
 */
export interface AnnotationQueryLink {
    trace_id: string
    span_id?: string
}

/**
 * Parameters for the batch annotation query endpoint.
 */
export interface AnnotationQueryParams {
    projectId: string
    annotationLinks: AnnotationQueryLink[]
    windowing?: {
        limit?: number
        order?: string
    }
}

// ============================================================================
// DETAIL PARAMETERS
// ============================================================================

/**
 * Parameters for fetching/updating/deleting a single annotation.
 */
export interface AnnotationDetailParams {
    projectId: string
    traceId: string
    spanId?: string
}

// ============================================================================
// MUTATION PAYLOADS
// ============================================================================

/**
 * Payload for creating a new annotation.
 */
export interface CreateAnnotationPayload {
    /** Annotation data (outputs) */
    data: {outputs?: Record<string, unknown>}
    /** Entity references (evaluator is required by backend) */
    references?: {
        evaluator: {id?: string; slug?: string}
        evaluator_revision?: {id?: string; slug?: string}
        testset?: {id?: string}
        testcase?: {id?: string}
    }
    /** Links to invocation traces (keyed by step key) */
    links?: Record<string, {trace_id?: string; span_id?: string}>
    /** How the annotation was submitted */
    channel?: "web" | "sdk" | "api"
    /** Purpose of the annotation */
    kind?: "adhoc" | "eval"
    /** How the annotation was created */
    origin?: "custom" | "human" | "auto"
    /** Metadata */
    meta?: {name?: string; description?: string; tags?: string[]}
}

/**
 * Payload for updating an existing annotation.
 */
export interface UpdateAnnotationPayload {
    annotation: {
        data: {outputs?: Record<string, unknown>}
        meta?: {name?: string; description?: string; tags?: string[]}
    }
}
