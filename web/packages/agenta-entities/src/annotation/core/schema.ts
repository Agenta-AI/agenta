/**
 * Annotation Entity Schemas
 *
 * Zod schemas for validation and type safety of Annotation entities.
 * The entity shape maps to the backend simple trace payload used to persist
 * annotations via `POST /simple/traces/`.
 *
 * Annotations are keyed by a composite `{trace_id, span_id}` pair.
 * Use `encodeAnnotationId` / `decodeAnnotationId` to convert between
 * the pair and a single string key for atom families.
 *
 * @packageDocumentation
 */

import {z} from "zod"

// ============================================================================
// ENUMS
// ============================================================================

/**
 * Annotation channel — how the annotation was submitted.
 * Maps to backend `AnnotationChannel`.
 */
export const annotationChannelSchema = z.enum(["web", "sdk", "api"])
export type AnnotationChannel = z.infer<typeof annotationChannelSchema>

/**
 * Annotation kind — purpose of the annotation.
 * Maps to backend `AnnotationKind`.
 */
export const annotationKindSchema = z.enum(["adhoc", "eval"])
export type AnnotationKind = z.infer<typeof annotationKindSchema>

/**
 * Annotation origin — how the annotation was created.
 * Maps to backend `AnnotationOrigin`.
 */
export const annotationOriginSchema = z.enum(["custom", "human", "auto"])
export type AnnotationOrigin = z.infer<typeof annotationOriginSchema>

// ============================================================================
// SUB-SCHEMAS
// ============================================================================

/**
 * A link to a trace/span pair.
 * Annotations use links to reference the invocation they annotate.
 */
export const annotationLinkSchema = z.object({
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
})
export type AnnotationLink = z.infer<typeof annotationLinkSchema>

/**
 * A reference to another entity (evaluator, testset, testcase, etc.).
 */
export const annotationReferenceSchema = z.object({
    id: z.string().optional(),
    slug: z.string().optional(),
    version: z.coerce.number().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
})
export type AnnotationReference = z.infer<typeof annotationReferenceSchema>

/**
 * References attached to an annotation.
 * `evaluator` is required by the backend.
 */
export const annotationReferencesSchema = z.object({
    evaluator: annotationReferenceSchema,
    evaluator_revision: annotationReferenceSchema.optional(),
    testset: annotationReferenceSchema.optional(),
    testset_variant: annotationReferenceSchema.optional(),
    testset_revision: annotationReferenceSchema.optional(),
    testcase: annotationReferenceSchema.optional(),
    application: annotationReferenceSchema.optional(),
    application_variant: annotationReferenceSchema.optional(),
    application_revision: annotationReferenceSchema.optional(),
    evaluator_variant: annotationReferenceSchema.optional(),
    query: annotationReferenceSchema.optional(),
    query_variant: annotationReferenceSchema.optional(),
    query_revision: annotationReferenceSchema.optional(),
})
export type AnnotationReferences = z.infer<typeof annotationReferencesSchema>

/**
 * Annotation metadata (name, description, tags).
 */
export const annotationMetaSchema = z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
})
export type AnnotationMeta = z.infer<typeof annotationMetaSchema>

/**
 * Annotation data payload — contains output values.
 */
export const annotationDataSchema = z.object({
    outputs: z.record(z.string(), z.unknown()).optional(),
})
export type AnnotationData = z.infer<typeof annotationDataSchema>

// ============================================================================
// ANNOTATION SCHEMA
// ============================================================================

/**
 * Annotation entity schema.
 * Maps to backend `Annotation(SimpleTrace, Link)`.
 *
 * Keyed by the composite `{trace_id, span_id}` pair.
 */
export const annotationSchema = z.object({
    // Identity (composite key)
    trace_id: z.string(),
    span_id: z.string(),

    // Data payload
    data: annotationDataSchema,

    // Entity references
    references: annotationReferencesSchema.optional(),

    // Links to invocation traces (keyed by step key)
    links: z.record(z.string(), annotationLinkSchema).optional(),

    // Classification
    channel: annotationChannelSchema.optional(),
    kind: annotationKindSchema.optional(),
    origin: annotationOriginSchema.optional(),

    // Metadata
    meta: annotationMetaSchema.optional(),

    // Timestamps & audit
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    created_by_id: z.string().optional(),
})

export type Annotation = z.infer<typeof annotationSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single annotation response envelope used by the annotation client abstraction.
 */
export const annotationResponseSchema = z.object({
    count: z.number().optional().default(0),
    annotation: annotationSchema.nullable().optional(),
})
export type AnnotationResponse = z.infer<typeof annotationResponseSchema>

/**
 * Multiple annotations response envelope used by the annotation client abstraction.
 */
export const annotationsResponseSchema = z.object({
    count: z.number().optional().default(0),
    annotations: z.array(annotationSchema).default([]),
})
export type AnnotationsResponse = z.infer<typeof annotationsResponseSchema>

// ============================================================================
// COMPOSITE KEY HELPERS
// ============================================================================

/**
 * Encode a `{traceId, spanId}` pair into a single string key for atom families.
 *
 * The colon separator is safe because trace/span IDs are hex or UUID strings.
 */
export function encodeAnnotationId(traceId: string, spanId: string): string {
    return `${traceId}:${spanId}`
}

/**
 * Decode a composite annotation ID back into `{traceId, spanId}`.
 */
export function decodeAnnotationId(compositeId: string): {traceId: string; spanId: string} {
    const colonIdx = compositeId.indexOf(":")
    if (colonIdx === -1) {
        throw new Error(`Invalid annotation composite ID: ${compositeId}`)
    }
    return {
        traceId: compositeId.slice(0, colonIdx),
        spanId: compositeId.slice(colonIdx + 1),
    }
}
