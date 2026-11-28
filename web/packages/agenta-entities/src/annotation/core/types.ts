/**
 * Annotation API Parameter Types
 *
 * Interfaces for API function parameters.
 *
 * @packageDocumentation
 */

import type {z} from "zod"

import type {annotationMetaSchema} from "./schema"

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

export interface AnnotationQueryReference {
    id?: string
    slug?: string
}

export interface AnnotationQueryFilter {
    references?: {
        evaluator?: AnnotationQueryReference
        evaluator_revision?: AnnotationQueryReference
        testset?: AnnotationQueryReference
        testcase?: AnnotationQueryReference
    }
    /** Inbound links: annotations that link any of these spans (for example a judge's result). */
    links?: {trace_id: string; span_id: string}[]
}

/**
 * Parameters for the batch annotation query endpoint.
 */
export interface AnnotationQueryParams {
    projectId: string
    annotationLinks?: AnnotationQueryLink[]
    annotation?: AnnotationQueryFilter
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
 * An annotation's free `meta`, as `annotationMetaSchema` reads it. `verdict` and `note` mark a
 * person's review of an automatic evaluator's result ("agree" or "disagree", and why).
 */
export type AnnotationMetaPayload = z.infer<typeof annotationMetaSchema>

/**
 * Payload for creating a new annotation.
 */
export interface CreateAnnotationPayload {
    /** Annotation data (outputs) */
    data: {outputs?: Record<string, unknown>}
    /** Entity references (evaluator is required by backend) */
    references?: {
        evaluator: {id?: string; slug?: string}
        evaluator_variant?: {id?: string; slug?: string}
        evaluator_revision?: {id?: string; slug?: string; version?: string | number}
        testset?: {id?: string}
        testset_revision?: {id?: string}
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
    meta?: AnnotationMetaPayload
}

/**
 * Payload for updating an existing annotation.
 */
export interface UpdateAnnotationPayload {
    annotation: {
        data: {outputs?: Record<string, unknown>}
        meta?: AnnotationMetaPayload
        references?: {
            evaluator: {id?: string; slug?: string}
            evaluator_variant?: {id?: string; slug?: string}
            evaluator_revision?: {id?: string; slug?: string; version?: string | number}
            testset?: {id?: string}
            testcase?: {id?: string}
        }
        links?: Record<string, {trace_id?: string; span_id?: string}>
    }
}
