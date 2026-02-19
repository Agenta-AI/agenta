/**
 * Workflow Entity Schemas
 *
 * Zod schemas for validation and type safety of workflow entities.
 * Workflows follow the Workflow → Variant → Revision hierarchy.
 *
 * ## Backend Model Hierarchy
 *
 * ```
 * Workflow (Artifact) — listed via POST /preview/workflows/query
 *   ├── id, slug, name, description, flags, tags, meta
 *   └── (no data field)
 *
 * WorkflowVariant — listed via POST /preview/workflows/variants/query
 *   ├── id, slug, name, workflow_id, flags
 *   └── (no data field)
 *
 * WorkflowRevision — fetched via GET /preview/workflows/revisions/{id}
 *   ├── id, slug, name, version, workflow_id, workflow_variant_id, flags
 *   └── data: WorkflowRevisionData (uri, url, schemas, parameters, script)
 * ```
 *
 * ## Flag System
 *
 * WorkflowFlags: { is_custom, is_evaluator, is_human, is_chat }
 * WorkflowQueryFlags: same but all optional — only set flags are matched (JSONB containment)
 *
 * @packageDocumentation
 */

import {z} from "zod"

import {createEntitySchemaSet, timestampFieldsSchema, auditFieldsSchema} from "../../shared"

// ============================================================================
// JSON SCHEMAS SUB-SCHEMA
// ============================================================================

/**
 * JsonSchemas — maps to SDK `JsonSchemas` model.
 * Contains JSON Schema definitions for parameters, inputs, and outputs.
 */
export const jsonSchemasSchema = z
    .object({
        parameters: z.record(z.string(), z.unknown()).nullable().optional(),
        inputs: z.record(z.string(), z.unknown()).nullable().optional(),
        outputs: z.record(z.string(), z.unknown()).nullable().optional(),
    })
    .nullable()
    .optional()

export type JsonSchemas = z.infer<typeof jsonSchemasSchema>

// ============================================================================
// WORKFLOW FLAGS
// ============================================================================

/**
 * WorkflowFlags — maps to backend `WorkflowFlags`.
 * All boolean flags with defaults. Used on create/edit operations.
 */
export const workflowFlagsSchema = z
    .object({
        is_custom: z.boolean().optional().default(false),
        is_evaluator: z.boolean().optional().default(false),
        is_human: z.boolean().optional().default(false),
        is_chat: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()

export type WorkflowFlags = z.infer<typeof workflowFlagsSchema>

/**
 * WorkflowQueryFlags — maps to backend `WorkflowQueryFlags`.
 * All flags are optional. Only provided flags are used for JSONB containment filtering.
 *
 * Examples:
 * - `{ is_evaluator: true }` → returns only evaluator workflows
 * - `{ is_chat: true }` → returns only chat workflows
 * - `{}` or undefined → returns ALL workflows
 */
export interface WorkflowQueryFlags {
    is_custom?: boolean
    is_evaluator?: boolean
    is_human?: boolean
    is_chat?: boolean
}

// ============================================================================
// WORKFLOW DATA
// ============================================================================

/**
 * WorkflowData — maps to backend `WorkflowRevisionData`.
 *
 * Combines WorkflowServiceInterface + WorkflowServiceConfiguration + legacy fields.
 */
export const workflowDataSchema = z.object({
    // WorkflowServiceInterface fields
    /** Data version string (e.g., "2025.07.14") */
    version: z.string().nullable().optional(),
    /** Workflow URI (e.g., "agenta:builtin:auto_exact_match:v0") */
    uri: z.string().nullable().optional(),
    /** Webhook/service URL */
    url: z.string().nullable().optional(),
    /** Custom headers */
    headers: z.record(z.string(), z.unknown()).nullable().optional(),
    /** JSON Schema definitions for parameters, inputs, and outputs */
    schemas: jsonSchemasSchema,

    // WorkflowServiceConfiguration fields
    /** Script content for custom code workflows */
    script: z.record(z.string(), z.unknown()).nullable().optional(),
    /** Configuration parameters */
    parameters: z.record(z.string(), z.unknown()).nullable().optional(),

    // Legacy fields (backward compatibility)
    /** @deprecated Legacy service configuration */
    service: z.record(z.string(), z.unknown()).nullable().optional(),
    /** @deprecated Legacy configuration parameters */
    configuration: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type WorkflowData = z.infer<typeof workflowDataSchema>

// ============================================================================
// WORKFLOW SCHEMA
// ============================================================================

/**
 * Workflow entity schema.
 *
 * Flexible schema that accommodates both:
 * - Workflow objects from `POST /preview/workflows/query` (list, no data)
 * - WorkflowRevision objects from `GET /preview/workflows/revisions/{id}` (detail, has data)
 */
export const workflowSchema = z
    .object({
        // Identifier
        id: z.string(),

        // Slug
        slug: z.string().nullable().optional(),

        // Version (present on revisions — backend returns as string, coerce to number)
        version: z.coerce.number().nullable().optional(),

        // Header
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Flags
        flags: workflowFlagsSchema,

        // Metadata
        tags: z.record(z.string(), z.unknown()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),

        // Revision data (present on revision responses, absent on workflow list)
        data: workflowDataSchema.nullable().optional(),

        // Workflow hierarchy IDs (from revision responses)
        workflow_id: z.string().nullable().optional(),
        workflow_variant_id: z.string().nullable().optional(),

        // Alias IDs (backward compat)
        variant_id: z.string().nullable().optional(),
        revision_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type Workflow = z.infer<typeof workflowSchema>

/**
 * Workflow schema set for create/update/local operations
 */
export const workflowSchemas = createEntitySchemaSet({
    base: workflowSchema,
    serverFields: [
        "created_at",
        "updated_at",
        "deleted_at",
        "created_by_id",
        "updated_by_id",
        "deleted_by_id",
        "variant_id",
        "revision_id",
    ],
    localDefaults: {
        slug: null,
        description: null,
        flags: {is_custom: false, is_evaluator: false, is_human: false, is_chat: false},
        tags: null,
        meta: null,
        data: null,
    },
})

export type CreateWorkflow = typeof workflowSchemas.types.Create
export type UpdateWorkflow = typeof workflowSchemas.types.Update
export type LocalWorkflow = typeof workflowSchemas.types.Local

// ============================================================================
// WORKFLOW VARIANT SCHEMA (for 3-level selection hierarchy)
// ============================================================================

/**
 * WorkflowVariant schema.
 * Matches backend `WorkflowVariant(Variant, WorkflowIdAlias)`.
 */
export const workflowVariantSchema = z
    .object({
        id: z.string(),
        slug: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        flags: workflowFlagsSchema,
        workflow_id: z.string().nullable().optional(),
        artifact_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type WorkflowVariant = z.infer<typeof workflowVariantSchema>

/**
 * Multiple workflow variants response wrapper.
 * Matches backend `WorkflowVariantsResponse`.
 */
export const workflowVariantsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_variants: z.array(workflowVariantSchema).default([]),
})

export type WorkflowVariantsResponse = z.infer<typeof workflowVariantsResponseSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single workflow response wrapper.
 * Matches backend `WorkflowResponse`.
 */
export const workflowResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow: workflowSchema.nullable().optional(),
})

export type WorkflowResponse = z.infer<typeof workflowResponseSchema>

/**
 * Multiple workflows response wrapper.
 * Matches backend `WorkflowsResponse`.
 */
export const workflowsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflows: z.array(workflowSchema).default([]),
})

export type WorkflowsResponse = z.infer<typeof workflowsResponseSchema>

/**
 * Single workflow revision response wrapper.
 * Matches backend `WorkflowRevisionResponse`.
 */
export const workflowRevisionResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_revision: workflowSchema.nullable().optional(),
})

export type WorkflowRevisionResponse = z.infer<typeof workflowRevisionResponseSchema>

/**
 * Multiple workflow revisions response wrapper.
 * Matches backend `WorkflowRevisionsResponse`.
 */
export const workflowRevisionsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_revisions: z.array(workflowSchema).default([]),
})

export type WorkflowRevisionsResponse = z.infer<typeof workflowRevisionsResponseSchema>

// ============================================================================
// URI UTILITIES
// ============================================================================

/**
 * Parse the key segment from a workflow URI.
 *
 * URI format: `provider:kind:key:version`
 * Example: `"agenta:builtin:auto_exact_match:v0"` → `"auto_exact_match"`
 */
export function parseWorkflowKeyFromUri(uri: string | null | undefined): string | null {
    if (!uri) return null
    const parts = uri.split(":")
    if (parts.length >= 3) {
        return parts[2]
    }
    return null
}

/**
 * Build a URI from key components.
 *
 * Example: `buildWorkflowUri("auto_exact_match")` → `"agenta:builtin:auto_exact_match:v0"`
 */
export function buildWorkflowUri(
    key: string,
    provider = "agenta",
    kind = "builtin",
    version = "v0",
): string {
    return `${provider}:${kind}:${key}:${version}`
}

// ============================================================================
// SLUG UTILITIES
// ============================================================================

export function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_.\-\s]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
}
