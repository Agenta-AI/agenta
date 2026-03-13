/**
 * Evaluator Entity Schemas
 *
 * Zod schemas for validation and type safety of evaluator entities.
 * Evaluators follow the Workflow → Variant → Revision hierarchy.
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
 * WorkflowRevision — fetched via GET /preview/workflows/revisions/retrieve
 *   ├── id, slug, name, version, workflow_id, workflow_variant_id, flags
 *   └── data: WorkflowRevisionData (uri, url, schemas, parameters, script)
 * ```
 *
 * ## WorkflowRevisionData
 *
 * ```
 * WorkflowServiceInterface:
 *   ├── version: str (e.g., "2025.07.14")
 *   ├── uri: str (e.g., "agenta:builtin:auto_exact_match:v0")
 *   ├── url: str (for webhook evaluators)
 *   ├── headers: Dict[str, Union[str, Reference]]
 *   └── schemas: JsonSchemas { parameters, inputs, outputs }
 *
 * WorkflowServiceConfiguration:
 *   ├── script: dict (for custom code evaluators)
 *   └── parameters: dict (evaluator settings/config values)
 *
 * Legacy fields (backward compat):
 *   ├── service: dict
 *   └── configuration: dict
 * ```
 *
 * @packageDocumentation
 */

import {z} from "zod"

import {createEntitySchemaSet, timestampFieldsSchema, auditFieldsSchema} from "../../shared"

// ============================================================================
// JSON SCHEMAS SUB-SCHEMA
// ============================================================================

/**
 * JsonSchemas — maps to SDK `JsonSchemas` model
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
// EVALUATOR FLAGS
// ============================================================================

/**
 * SimpleEvaluatorFlags — maps to backend `SimpleEvaluatorFlags(EvaluatorFlags(WorkflowFlags))`
 *
 * `is_evaluator` is always `true` for evaluators (enforced by backend constructor).
 */
export const evaluatorFlagsSchema = z
    .object({
        is_custom: z.boolean().optional().default(false),
        is_evaluator: z.boolean().optional().default(true),
        is_human: z.boolean().optional().default(false),
        is_chat: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()

export type EvaluatorFlags = z.infer<typeof evaluatorFlagsSchema>

// ============================================================================
// EVALUATOR DATA
// ============================================================================

/**
 * SimpleEvaluatorData — maps to backend `SimpleEvaluatorData(EvaluatorRevisionData(WorkflowRevisionData))`
 *
 * This is the revision data embedded in a SimpleEvaluator response.
 * It combines WorkflowServiceInterface + WorkflowServiceConfiguration + legacy fields.
 */
export const evaluatorDataSchema = z.object({
    // WorkflowServiceInterface fields
    /** Data version string (e.g., "2025.07.14") */
    version: z.string().nullable().optional(),
    /** Evaluator URI (e.g., "agenta:builtin:auto_exact_match:v0") */
    uri: z.string().nullable().optional(),
    /** Webhook URL (for webhook evaluators) */
    url: z.string().nullable().optional(),
    /** Custom headers for webhook evaluators */
    headers: z.record(z.string(), z.unknown()).nullable().optional(),
    /** JSON Schema definitions for parameters, inputs, and outputs */
    schemas: jsonSchemasSchema,

    // WorkflowServiceConfiguration fields
    /** Script content for custom code evaluators */
    script: z.record(z.string(), z.unknown()).nullable().optional(),
    /** Evaluator configuration parameters (equivalent to legacy settings_values) */
    parameters: z.record(z.string(), z.unknown()).nullable().optional(),

    // Legacy fields (backward compatibility)
    /** @deprecated Legacy service configuration */
    service: z.record(z.string(), z.unknown()).nullable().optional(),
    /** @deprecated Legacy configuration parameters */
    configuration: z.record(z.string(), z.unknown()).nullable().optional(),
})

export type EvaluatorData = z.infer<typeof evaluatorDataSchema>

// ============================================================================
// SIMPLE EVALUATOR SCHEMA
// ============================================================================

/**
 * Evaluator entity schema.
 *
 * Flexible schema that accommodates both:
 * - Workflow objects from `POST /preview/workflows/query` (list, no data)
 * - WorkflowRevision objects from `GET /preview/workflows/revisions/retrieve` (detail, has data)
 */
export const evaluatorSchema = z
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
        flags: evaluatorFlagsSchema,

        // Metadata
        tags: z.record(z.string(), z.unknown()).nullable().optional(),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),

        // Revision data (present on revision responses, absent on workflow list)
        data: evaluatorDataSchema.nullable().optional(),

        // Workflow hierarchy IDs (from revision responses)
        workflow_id: z.string().nullable().optional(),
        workflow_variant_id: z.string().nullable().optional(),

        // Legacy IDs (from SimpleEvaluator DTO, backward compat)
        variant_id: z.string().nullable().optional(),
        revision_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type Evaluator = z.infer<typeof evaluatorSchema>

/**
 * Evaluator schema set for create/update/local operations
 */
export const evaluatorSchemas = createEntitySchemaSet({
    base: evaluatorSchema,
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
        flags: {is_custom: false, is_evaluator: true, is_human: false, is_chat: false},
        tags: null,
        meta: null,
        data: null,
    },
})

export type CreateEvaluator = typeof evaluatorSchemas.types.Create
export type UpdateEvaluator = typeof evaluatorSchemas.types.Update
export type LocalEvaluator = typeof evaluatorSchemas.types.Local

// ============================================================================
// WORKFLOW VARIANT SCHEMA (for 3-level selection hierarchy)
// ============================================================================

/**
 * WorkflowVariant schema.
 * Matches backend `WorkflowVariant(Variant, WorkflowIdAlias)`.
 * Used in the Evaluator → Variant → Revision selection hierarchy.
 */
export const evaluatorVariantSchema = z
    .object({
        id: z.string(),
        slug: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        flags: evaluatorFlagsSchema,
        workflow_id: z.string().nullable().optional(),
        artifact_id: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type EvaluatorVariant = z.infer<typeof evaluatorVariantSchema>

/**
 * Multiple workflow variants response wrapper.
 * Matches backend `WorkflowVariantsResponse` from `POST /preview/workflows/variants/query`.
 */
export const evaluatorVariantsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_variants: z.array(evaluatorVariantSchema).default([]),
})

export type EvaluatorVariantsResponse = z.infer<typeof evaluatorVariantsResponseSchema>

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single workflow response wrapper.
 * Matches backend `WorkflowResponse` from `GET /preview/workflows/{id}`.
 */
export const evaluatorResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow: evaluatorSchema.nullable().optional(),
})

export type EvaluatorResponse = z.infer<typeof evaluatorResponseSchema>

/**
 * Multiple workflows response wrapper.
 * Matches backend `WorkflowsResponse` from `POST /preview/workflows/query`.
 */
export const evaluatorsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflows: z.array(evaluatorSchema).default([]),
})

export type EvaluatorsResponse = z.infer<typeof evaluatorsResponseSchema>

/**
 * Single workflow revision response wrapper.
 * Matches backend `WorkflowRevisionResponse`.
 */
export const evaluatorRevisionResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_revision: evaluatorSchema.nullable().optional(),
})

export type EvaluatorRevisionResponse = z.infer<typeof evaluatorRevisionResponseSchema>

/**
 * Multiple workflow revisions response wrapper.
 * Matches backend `WorkflowRevisionsResponse` from `POST /preview/workflows/revisions/query`.
 * Each revision contains `data` (uri, schemas, parameters, etc.).
 */
export const evaluatorRevisionsResponseSchema = z.object({
    count: z.number().optional().default(0),
    workflow_revisions: z.array(evaluatorSchema).default([]),
})

export type EvaluatorRevisionsResponse = z.infer<typeof evaluatorRevisionsResponseSchema>

// ============================================================================
// URI UTILITIES
// ============================================================================

/**
 * Parse evaluator key from a URI string.
 *
 * URI format: `provider:kind:key:version`
 * Example: `"agenta:builtin:auto_exact_match:v0"` → `"auto_exact_match"`
 */
export function parseEvaluatorKeyFromUri(uri: string | null | undefined): string | null {
    if (!uri) return null
    const parts = uri.split(":")
    // Expected format: provider:kind:key:version (4 parts)
    if (parts.length >= 3) {
        return parts[2]
    }
    return null
}

/**
 * Build a URI from an evaluator key.
 *
 * Example: `"auto_exact_match"` → `"agenta:builtin:auto_exact_match:v0"`
 */
export function buildEvaluatorUri(
    evaluatorKey: string,
    provider = "agenta",
    kind = "builtin",
    version = "v0",
): string {
    return `${provider}:${kind}:${evaluatorKey}:${version}`
}

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/**
 * Ant Design preset color names used for evaluator coloring.
 * Matches the legacy `tagColors` array from `oss/src/lib/helpers/colors.ts`.
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

/**
 * Ant Design preset color hex values (bg, text, border) for each color name.
 */
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
    /** Ant Design preset color name */
    name: string
    /** Background hex (light tint) */
    bg: string
    /** Text/icon hex (saturated) */
    text: string
    /** Border hex (mid tint) */
    border: string
}

/**
 * Simple char-code hash mapped to a range.
 * Mirrors `stringToNumberInRange` from `oss/src/lib/helpers/utils.ts`.
 */
function hashToRange(text: string, min: number, max: number): number {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash += text.charCodeAt(i)
    }
    const range = max - min + 1
    return min + (((hash % range) + range) % range)
}

/**
 * Derive a deterministic color for an evaluator from its URI or key.
 *
 * Accepts either:
 * - A full URI: `"agenta:builtin:auto_exact_match:v0"` (key is extracted)
 * - A bare evaluator key: `"auto_exact_match"`
 *
 * Returns `null` if the input is empty/null.
 *
 * @example
 * ```ts
 * const color = getEvaluatorColor("agenta:builtin:auto_similarity_match:v0")
 * // { name: "purple", bg: "#f9f0ff", text: "#722ed1", border: "#d3adf7" }
 *
 * const color2 = getEvaluatorColor("auto_exact_match")
 * // { name: "blue", bg: "#e6f4ff", text: "#1677ff", border: "#91caff" }
 * ```
 */
export function getEvaluatorColor(uriOrKey: string | null | undefined): EvaluatorColor | null {
    if (!uriOrKey) return null

    // If it looks like a URI (contains ":"), extract the key
    const key = uriOrKey.includes(":") ? parseEvaluatorKeyFromUri(uriOrKey) : uriOrKey
    if (!key) return null

    const index = hashToRange(key, 0, PRESET_COLOR_NAMES.length - 1)
    const colorName = PRESET_COLOR_NAMES[index]
    return PRESET_COLOR_MAP[colorName]
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
