/**
 * LegacyEvaluator Entity Schemas
 *
 * Zod schemas for validation and type safety of SimpleEvaluator entities.
 * These match the SimpleEvaluator response shape from the backend
 * `/preview/simple/evaluators/` endpoints.
 *
 * ## Backend Model Hierarchy (flattened by SimpleEvaluator facade)
 *
 * ```
 * SimpleEvaluator — assembled from Artifact + latest Revision
 *   ├── id, slug, name, description, tags, meta
 *   ├── flags: SimpleEvaluatorFlags (is_custom, is_evaluator, is_human, is_chat)
 *   └── data: SimpleEvaluatorData
 *       ├── version, uri, url, headers
 *       ├── schemas: JsonSchemas { parameters, inputs, outputs }
 *       ├── script: { content, runtime }
 *       ├── parameters: { ... }  (evaluator settings/config values)
 *       └── service, configuration (legacy compat)
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
// SIMPLE EVALUATOR FLAGS
// ============================================================================

/**
 * SimpleEvaluatorFlags — maps to backend `SimpleEvaluatorFlags(EvaluatorFlags(WorkflowFlags))`.
 *
 * `is_evaluator` is always `true` for evaluators (enforced by backend constructor).
 */
export const legacyEvaluatorFlagsSchema = z
    .object({
        is_custom: z.boolean().optional().default(false),
        is_evaluator: z.boolean().optional().default(true),
        is_human: z.boolean().optional().default(false),
        is_chat: z.boolean().optional().default(false),
    })
    .nullable()
    .optional()

export type LegacyEvaluatorFlags = z.infer<typeof legacyEvaluatorFlagsSchema>

// ============================================================================
// SIMPLE EVALUATOR DATA
// ============================================================================

/**
 * SimpleEvaluatorData — maps to backend
 * `SimpleEvaluatorData(EvaluatorRevisionData(WorkflowRevisionData))`.
 *
 * This is the revision data flattened into the SimpleEvaluator response.
 * Combines WorkflowServiceInterface + WorkflowServiceConfiguration + legacy fields.
 */
export const legacyEvaluatorDataSchema = z.object({
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

export type LegacyEvaluatorData = z.infer<typeof legacyEvaluatorDataSchema>

// ============================================================================
// SIMPLE EVALUATOR SCHEMA
// ============================================================================

/**
 * SimpleEvaluator schema.
 *
 * Matches the backend `SimpleEvaluator` response from `/preview/simple/evaluators/`.
 * The SimpleEvaluator flattens Artifact + latest Revision into a single object.
 */
export const legacyEvaluatorSchema = z
    .object({
        // Identifier
        id: z.string(),

        // Slug
        slug: z.string().nullable().optional(),

        // Header
        name: z.string().nullable().optional(),
        description: z.string().nullable().optional(),

        // Flags
        flags: legacyEvaluatorFlagsSchema,

        // Metadata
        tags: z.preprocess(
            (val) => (Array.isArray(val) ? val : val === null || val === undefined ? val : []),
            z.array(z.string()).nullable().optional(),
        ),
        meta: z.record(z.string(), z.unknown()).nullable().optional(),

        // Revision data (flattened from latest revision)
        data: legacyEvaluatorDataSchema.nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)

export type LegacyEvaluator = z.infer<typeof legacyEvaluatorSchema>

/**
 * LegacyEvaluator schema set for create/update/local operations.
 */
export const legacyEvaluatorSchemas = createEntitySchemaSet({
    base: legacyEvaluatorSchema,
    serverFields: [
        "created_at",
        "updated_at",
        "deleted_at",
        "created_by_id",
        "updated_by_id",
        "deleted_by_id",
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

export type CreateLegacyEvaluator = typeof legacyEvaluatorSchemas.types.Create
export type UpdateLegacyEvaluator = typeof legacyEvaluatorSchemas.types.Update
export type LocalLegacyEvaluator = typeof legacyEvaluatorSchemas.types.Local

// ============================================================================
// RESPONSE SCHEMAS
// ============================================================================

/**
 * Single SimpleEvaluator response wrapper.
 * Matches backend `SimpleEvaluatorResponse`.
 */
export const legacyEvaluatorResponseSchema = z.object({
    count: z.number().optional().default(0),
    evaluator: legacyEvaluatorSchema.nullable().optional(),
})

export type LegacyEvaluatorResponse = z.infer<typeof legacyEvaluatorResponseSchema>

/**
 * Multiple SimpleEvaluators response wrapper.
 * Matches backend `SimpleEvaluatorsResponse`.
 *
 * The `evaluators` field is pre-processed: if the API returns an object
 * (e.g. a dict keyed by ID) instead of an array, we coerce it to an array
 * of its values so downstream code always sees `LegacyEvaluator[]`.
 */
export const legacyEvaluatorsResponseSchema = z.object({
    count: z.number().optional().default(0),
    evaluators: z.preprocess(
        (val) =>
            Array.isArray(val)
                ? val
                : typeof val === "object" && val !== null
                  ? Object.values(val)
                  : [],
        z.array(legacyEvaluatorSchema).default([]),
    ),
})

export type LegacyEvaluatorsResponse = z.infer<typeof legacyEvaluatorsResponseSchema>

// ============================================================================
// URI UTILITIES (re-export from evaluator core for convenience)
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
// SLUG UTILITIES
// ============================================================================

/**
 * Generate a URL-safe slug from a name.
 */
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
// COLOR UTILITIES
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

const PRESET_COLOR_MAP: Record<PresetColorName, LegacyEvaluatorColor> = {
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

export interface LegacyEvaluatorColor {
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
 * Derive a deterministic color for an evaluator from its URI or key.
 */
export function getEvaluatorColor(
    uriOrKey: string | null | undefined,
): LegacyEvaluatorColor | null {
    if (!uriOrKey) return null
    const key = uriOrKey.includes(":") ? parseEvaluatorKeyFromUri(uriOrKey) : uriOrKey
    if (!key) return null
    const index = hashToRange(key, 0, PRESET_COLOR_NAMES.length - 1)
    const colorName = PRESET_COLOR_NAMES[index]
    return PRESET_COLOR_MAP[colorName]
}
