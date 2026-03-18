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
        /** Local-only ephemeral entity created from trace data (not persisted on backend) */
        is_base: z.boolean().optional().default(false),
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

        // Folder scope (from artifact-level FolderScope mixin)
        folder_id: z.string().nullable().optional(),

        // Workflow hierarchy IDs (from revision responses)
        workflow_id: z.string().nullable().optional(),
        workflow_variant_id: z.string().nullable().optional(),

        // Commit fields
        /** Commit message (from CommitDBA on revision responses) */
        message: z.string().nullable().optional(),

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
        flags: {
            is_custom: false,
            is_evaluator: false,
            is_human: false,
            is_chat: false,
            is_base: false,
        },
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
 * Single workflow variant response wrapper.
 * Matches backend `WorkflowVariantResponse`.
 */
export const workflowVariantResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_variant: workflowVariantSchema.nullable().optional(),
})

export type WorkflowVariantResponse = z.infer<typeof workflowVariantResponseSchema>

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
 * Windowing metadata returned by paginated query endpoints.
 */
export const windowingResponseSchema = z
    .object({
        next: z.string().nullable().optional(),
    })
    .nullable()
    .optional()

export type WindowingResponse = z.infer<typeof windowingResponseSchema>

/**
 * Multiple workflows response wrapper.
 * Matches backend `WorkflowsResponse`.
 */
export const workflowsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflows: z.array(workflowSchema).default([]),
    windowing: windowingResponseSchema,
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
    windowing: windowingResponseSchema,
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
// EVALUATOR COLOR UTILITIES
// ============================================================================

/**
 * Ant Design preset color names used for evaluator coloring.
 */
const PRESET_COLOR_NAMES = [
    "blue",
    "purple",
    "cyan",
    "green",
    "magenta",
    "pink",
    "red",
    "orange",
    "yellow",
    "volcano",
    "geekblue",
    "lime",
    "gold",
] as const

type PresetColorName = (typeof PRESET_COLOR_NAMES)[number]

const PRESET_COLOR_MAP: Record<PresetColorName, EvaluatorColor> = {
    blue: {name: "blue", bg: "#e6f4ff", text: "#1677ff", border: "#91caff"},
    purple: {name: "purple", bg: "#f9f0ff", text: "#722ed1", border: "#d3adf7"},
    cyan: {name: "cyan", bg: "#e6fffb", text: "#13c2c2", border: "#87e8de"},
    green: {name: "green", bg: "#f6ffed", text: "#52c41a", border: "#b7eb8f"},
    magenta: {name: "magenta", bg: "#fff0f6", text: "#eb2f96", border: "#ffadd2"},
    pink: {name: "pink", bg: "#fff0f6", text: "#eb2f96", border: "#ffadd2"},
    red: {name: "red", bg: "#fff2f0", text: "#f5222d", border: "#ffccc7"},
    orange: {name: "orange", bg: "#fff7e6", text: "#fa8c16", border: "#ffd591"},
    yellow: {name: "yellow", bg: "#feffe6", text: "#fadb14", border: "#fffb8f"},
    volcano: {name: "volcano", bg: "#fff2e8", text: "#fa541c", border: "#ffbb96"},
    geekblue: {name: "geekblue", bg: "#f0f5ff", text: "#2f54eb", border: "#adc6ff"},
    lime: {name: "lime", bg: "#fcffe6", text: "#a0d911", border: "#eaff8f"},
    gold: {name: "gold", bg: "#fffbe6", text: "#faad14", border: "#ffe58f"},
}

export interface EvaluatorColor {
    name: string
    bg: string
    text: string
    border: string
}

function hashToRange(text: string, min: number, max: number): number {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }
    const range = max - min + 1
    return min + (((hash % range) + range) % range)
}

/**
 * Derive a deterministic color for an evaluator workflow from its URI or key.
 * Only meaningful for evaluator-type workflows (`flags.is_evaluator === true`).
 * Returns `null` for empty input.
 */
export function getEvaluatorColor(uriOrKey: string | null | undefined): EvaluatorColor | null {
    if (!uriOrKey) return null
    const key = uriOrKey.includes(":") ? parseWorkflowKeyFromUri(uriOrKey) : uriOrKey
    if (!key) return null
    const index = hashToRange(key, 0, PRESET_COLOR_NAMES.length - 1)
    const colorName = PRESET_COLOR_NAMES[index]
    return PRESET_COLOR_MAP[colorName]
}

/**
 * @deprecated Use `parseWorkflowKeyFromUri` instead.
 */
export const parseEvaluatorKeyFromUri = parseWorkflowKeyFromUri

/**
 * @deprecated Use `buildWorkflowUri` instead.
 */
export const buildEvaluatorUri = buildWorkflowUri

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

// ============================================================================
// OUTPUT SCHEMA UTILITIES
// ============================================================================

/**
 * Resolve output metric properties from a workflow's data.
 * Checks modern path first (`data.schemas.outputs.properties`),
 * then falls back to legacy path (`data.service.format.properties.outputs.properties`).
 */
export function resolveOutputSchemaProperties(
    data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!data) return null

    // Modern path: data.schemas.outputs.properties
    const schemas = data.schemas as Record<string, unknown> | undefined
    if (schemas?.outputs && typeof schemas.outputs === "object") {
        const props = (schemas.outputs as Record<string, unknown>)?.properties
        if (props && typeof props === "object") {
            return props as Record<string, unknown>
        }
    }

    // Legacy path: data.service.format.properties.outputs.properties
    const service = data.service as Record<string, unknown> | undefined
    const format = service?.format as Record<string, unknown> | undefined
    const formatProps = format?.properties as Record<string, unknown> | undefined
    const outputs = formatProps?.outputs as Record<string, unknown> | undefined
    if (outputs?.properties && typeof outputs.properties === "object") {
        return outputs.properties as Record<string, unknown>
    }

    return null
}
