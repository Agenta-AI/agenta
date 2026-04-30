/**
 * Workflow Entity Schemas
 *
 * Zod schemas for validation and type safety of workflow entities.
 * Workflows follow the Workflow → Variant → Revision hierarchy.
 *
 * ## Backend Model Hierarchy
 *
 * ```
 * Workflow (Artifact) — listed via POST /workflows/query
 *   ├── id, slug, name, description, flags, tags, meta
 *   └── (no data field)
 *
 * WorkflowVariant — listed via POST /workflows/variants/query
 *   ├── id, slug, name, workflow_id, flags
 *   └── (no data field)
 *
 * WorkflowRevision — fetched via GET /workflows/revisions/{id}
 *   ├── id, slug, name, version, workflow_id, workflow_variant_id, flags
 *   └── data: WorkflowRevisionData (uri, url, schemas, parameters, script)
 * ```
 *
 * ## Flag System
 *
 * WorkflowFlags: { is_custom, is_evaluator, is_feedback, is_chat }
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
 *
 * Three categories of flags, all derived at commit time by `infer_flags_from_data()`:
 *
 * **URI-derived** (from `provider:kind:key:version`):
 * - `is_managed` — provider is "agenta" (managed platform workflow)
 * - `is_custom` — kind is "custom" (user-deployed code on agenta platform)
 * - `is_llm` — key is "llm" (LLM handler)
 * - `is_hook` — key is "hook" (webhook handler)
 * - `is_code` — key is "code" (script/code handler)
 * - `is_match` — key is "match" (matcher evaluator)
 * - `is_feedback` — key is "trace" (human annotation workflow)
 *
 * **Interface-derived** (from revision data presence):
 * - `is_chat` — schema indicates chat/message semantics
 * - `has_url` — revision has a webhook/service URL
 * - `has_script` — revision has embedded script content
 * - `has_handler` — revision has an in-process handler (SDK only)
 *
 * **User-defined role** (set at create/commit, table-driven defaults from URI):
 * - `is_application` — can be used as an application
 * - `is_evaluator` — can be used as an evaluator
 * - `is_snippet` — reusable code snippet
 *
 * **Local-only** (never sent to backend):
 * - `is_base` — ephemeral entity created from trace data
 */
export const workflowFlagsSchema = z
    .object({
        // URI-derived
        is_managed: z.boolean().optional().default(false),
        is_custom: z.boolean().optional().default(false),
        is_llm: z.boolean().optional().default(false),
        is_hook: z.boolean().optional().default(false),
        is_code: z.boolean().optional().default(false),
        is_match: z.boolean().optional().default(false),
        is_feedback: z.boolean().optional().default(false),
        // Interface-derived
        is_chat: z.boolean().optional().default(false),
        has_url: z.boolean().optional().default(false),
        has_script: z.boolean().optional().default(false),
        has_handler: z.boolean().optional().default(false),
        // User-defined role
        is_application: z.boolean().optional().default(false),
        is_evaluator: z.boolean().optional().default(false),
        is_snippet: z.boolean().optional().default(false),
        // Local-only (not persisted on backend)
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
 * - `{ is_managed: true, is_llm: true }` → returns managed LLM workflows
 * - `{}` or undefined → returns ALL workflows
 */
export interface WorkflowQueryFlags {
    // URI-derived
    is_managed?: boolean
    is_custom?: boolean
    is_llm?: boolean
    is_hook?: boolean
    is_code?: boolean
    is_match?: boolean
    is_feedback?: boolean
    // Interface-derived
    is_chat?: boolean
    has_url?: boolean
    has_script?: boolean
    has_handler?: boolean
    // User-defined role
    is_application?: boolean
    is_evaluator?: boolean
    is_snippet?: boolean
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
    /** Workflow URI (e.g., "agenta:builtin:auto_exact_match:v0") */
    uri: z.string().nullable().optional(),

    /** JSON Schema definitions for parameters, inputs, and outputs */
    schemas: jsonSchemasSchema,

    /** Configuration parameters */
    parameters: z.record(z.string(), z.unknown()).nullable().optional(),

    /** Webhook/service URL */
    url: z.string().nullable().optional(),
    /** Custom headers */
    headers: z.record(z.string(), z.unknown()).nullable().optional(),

    /** Script content for custom code workflows */
    script: z.string().nullable().optional(),
    /** Runtime identifier for code-backed evaluators */
    runtime: z.string().nullable().optional(),
})

export type WorkflowData = z.infer<typeof workflowDataSchema>

/**
 * Accepted input type for all workflow data resolver functions.
 * Accepts `WorkflowData`, arbitrary records (e.g. `EvaluatorDto.data`), or nullish values.
 */
export type WorkflowDataInput = WorkflowData | Record<string, unknown> | null | undefined

function asRecord(data: WorkflowDataInput): Record<string, unknown> | null {
    if (!data || typeof data !== "object") return null
    return data as Record<string, unknown>
}

function resolveSchemas(data: WorkflowDataInput): Record<string, unknown> | null {
    const rec = asRecord(data)
    if (!rec) return null

    const schemas = rec.schemas
    if (schemas && typeof schemas === "object") {
        return schemas as Record<string, unknown>
    }

    return null
}

function resolveNamedSchema(
    data: WorkflowDataInput,
    name: "inputs" | "outputs" | "parameters",
): Record<string, unknown> | null {
    const schemas = resolveSchemas(data)
    const schema = schemas?.[name]
    if (schema && typeof schema === "object") {
        return schema as Record<string, unknown>
    }

    return null
}

export function resolveParameters(data: WorkflowDataInput): Record<string, unknown> | null {
    const rec = asRecord(data)
    if (!rec) return null

    const parameters = rec.parameters
    if (parameters && typeof parameters === "object") {
        return parameters as Record<string, unknown>
    }

    return null
}

export function resolveScript(data: WorkflowDataInput): string | null {
    const rec = asRecord(data)
    if (!rec) return null

    const script = rec.script
    if (typeof script === "string" && script.trim()) {
        return script
    }

    if (script && typeof script === "object") {
        const content = (script as Record<string, unknown>).content
        if (typeof content === "string" && content.trim()) {
            return content
        }
    }

    return null
}

export function resolveInputSchema(data: WorkflowDataInput): Record<string, unknown> | null {
    return resolveNamedSchema(data, "inputs")
}

export function resolveParametersSchema(data: WorkflowDataInput): Record<string, unknown> | null {
    return resolveNamedSchema(data, "parameters")
}

// ============================================================================
// WORKFLOW SCHEMA
// ============================================================================

/**
 * Workflow entity schema.
 *
 * Flexible schema that accommodates both:
 * - Workflow objects from `POST /workflows/query` (list, no data)
 * - WorkflowRevision objects from `GET /workflows/revisions/{id}` (detail, has data)
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
            // URI-derived
            is_managed: false,
            is_custom: false,
            is_llm: false,
            is_hook: false,
            is_code: false,
            is_match: false,
            is_feedback: false,
            // Interface-derived
            is_chat: false,
            has_url: false,
            has_script: false,
            has_handler: false,
            // User-defined role
            is_application: false,
            is_evaluator: false,
            is_snippet: false,
            // Local-only
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
 * Fixed preset colors for app workflow types.
 *
 * Apps can't use the hash-based `getEvaluatorColor` because they only have a
 * handful of types (`chat`/`completion`/`custom`) and users expect each type
 * to have a stable, semantically-chosen color across the product. Returning
 * the same `EvaluatorColor` shape lets app and evaluator tags share the
 * exact same bordered-pill rendering.
 */
const APP_TYPE_PRESET: Record<string, PresetColorName> = {
    chat: "blue",
    completion: "cyan",
    custom: "gold",
}

export function getAppTypeColor(appType: string | null | undefined): EvaluatorColor | null {
    if (!appType) return null
    const presetName = APP_TYPE_PRESET[appType]
    if (!presetName) return null
    return PRESET_COLOR_MAP[presetName]
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
// EVALUATOR KEY NORMALIZATION
// ============================================================================

/**
 * Normalize evaluator key strings into a set of lookup candidates.
 *
 * Given one or more raw key values (from URI, metadata, slug, name, etc.),
 * produces a deduplicated list of normalized candidates for matching:
 * - Lowercased original
 * - `auto_` prefix stripped (e.g., `auto_exact_match` → also `exact_match`)
 * - First hyphen segment extracted (e.g., `custom-code` → also `custom`)
 *
 * This is the canonical key normalization used across the evaluator system.
 */
export function collectEvaluatorCandidates(...values: (string | undefined | null)[]): string[] {
    const set = new Set<string>()
    for (const value of values) {
        if (value == null) continue
        const normalized = String(value).trim().toLowerCase()
        if (!normalized) continue
        set.add(normalized)
        if (normalized.startsWith("auto_")) set.add(normalized.slice(5))
        if (normalized.includes("-")) set.add(normalized.split("-")[0])
    }
    return Array.from(set)
}

// ============================================================================
// ONLINE EVALUATION CAPABILITY
// ============================================================================

/**
 * Legacy evaluator keys known to support online (real-time, trace-based) evaluation.
 *
 * Used as a fallback when workflow flags (`is_code`, `is_hook`, `is_llm`)
 * are not populated (evaluators created before `infer_flags_from_data` was deployed).
 *
 * After the evaluator key consolidation (managed-workflows.md), the legacy keys
 * will be retired. The canonical keys (`code`, `hook`, `llm`) are included
 * proactively for forward compatibility.
 */
const ONLINE_CAPABLE_KEYS = new Set([
    // Legacy keys
    "auto_regex_test",
    "auto_custom_code_run",
    "auto_webhook_test",
    "auto_ai_critique",
    // Bare keys (auto_ prefix stripped)
    "regex_test",
    "custom_code_run",
    "webhook_test",
    "ai_critique",
    // Canonical family keys (post-consolidation)
    "code",
    "hook",
    "llm",
])

/**
 * Determine whether an evaluator workflow supports online (real-time) evaluation.
 *
 * Uses a two-tier check:
 * 1. **Flags** (preferred): `is_custom`, `is_code`, `is_hook`, or `is_llm` — set by
 *    `infer_flags_from_data()` at commit time. These map directly to the
 *    canonical evaluator families that support online execution.
 * 2. **Key fallback** (legacy): For evaluators created before the flags system
 *    was deployed, falls back to matching the evaluator key against a known set.
 *
 * @param evaluator - Any object with optional `flags` and `data.uri` / `meta`
 * @returns `true` if the evaluator can execute in real-time against traces
 */
export function isOnlineCapableEvaluator(evaluator: {
    flags?: Record<string, unknown> | null
    data?: {uri?: string | null} | null
    meta?: Record<string, unknown> | null
    slug?: string | null
}): boolean {
    const flags = evaluator.flags
    if (flags?.is_custom || flags?.is_code || flags?.is_hook || flags?.is_llm) {
        return true
    }

    // Fallback: extract key from URI or metadata and check against known set
    const uri = evaluator.data?.uri
    const keyFromUri = typeof uri === "string" ? parseWorkflowKeyFromUri(uri) : null
    const keyFromMeta =
        (evaluator.meta?.evaluator_key as string) ?? (evaluator.meta?.key as string) ?? null

    const candidates = collectEvaluatorCandidates(keyFromUri, keyFromMeta, evaluator.slug)
    return candidates.some((c) => ONLINE_CAPABLE_KEYS.has(c))
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

// ============================================================================
// OUTPUT SCHEMA UTILITIES
// ============================================================================

/**
 * Resolve the full output schema object from a workflow's data.
 * Returns the entire schema (including `$defs`, `type`, etc.), not just properties.
 */
export function resolveOutputSchema(data: WorkflowDataInput): Record<string, unknown> | null {
    return resolveNamedSchema(data, "outputs")
}

/**
 * Resolve output metric properties from a workflow's data.
 */
export function resolveOutputSchemaProperties(
    data: WorkflowDataInput,
): Record<string, unknown> | null {
    const schema = resolveOutputSchema(data)
    if (!schema) return null

    const props = schema.properties
    if (props && typeof props === "object") {
        return props as Record<string, unknown>
    }

    return null
}
