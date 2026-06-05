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

        // Parent slugs (from revision responses; backend returns artifact_slug
        // and variant_slug alongside the IDs so callers can verify which
        // workflow/variant the revision belongs to without a second lookup).
        workflow_slug: z.string().nullable().optional(),
        workflow_variant_slug: z.string().nullable().optional(),
        artifact_slug: z.string().nullable().optional(),
        variant_slug: z.string().nullable().optional(),

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
// WORKFLOW TYPE COLOR UTILITIES
// ============================================================================

type PresetColorName =
    | "blue"
    | "purple"
    | "cyan"
    | "green"
    | "magenta"
    | "pink"
    | "red"
    | "orange"
    | "yellow"
    | "volcano"
    | "geekblue"
    | "lime"
    | "gold"

export interface WorkflowTypeColor {
    name: PresetColorName
    bg: string
    text: string
    border: string
}

const PRESET_COLOR_MAP: Record<PresetColorName, WorkflowTypeColor> = {
    blue: {
        name: "blue",
        bg: "var(--ant-blue-1)",
        text: "var(--ant-blue-6)",
        border: "var(--ant-blue-3)",
    },
    purple: {
        name: "purple",
        bg: "var(--ant-purple-1)",
        text: "var(--ant-purple-6)",
        border: "var(--ant-purple-3)",
    },
    cyan: {
        name: "cyan",
        bg: "var(--ant-cyan-1)",
        text: "var(--ant-cyan-6)",
        border: "var(--ant-cyan-3)",
    },
    green: {
        name: "green",
        bg: "var(--ant-green-1)",
        text: "var(--ant-green-6)",
        border: "var(--ant-green-3)",
    },
    magenta: {
        name: "magenta",
        bg: "var(--ant-magenta-1)",
        text: "var(--ant-magenta-6)",
        border: "var(--ant-magenta-3)",
    },
    pink: {
        name: "pink",
        bg: "var(--ant-pink-1)",
        text: "var(--ant-pink-6)",
        border: "var(--ant-pink-3)",
    },
    red: {
        name: "red",
        bg: "var(--ant-red-1)",
        text: "var(--ant-red-6)",
        border: "var(--ant-red-3)",
    },
    orange: {
        name: "orange",
        bg: "var(--ant-orange-1)",
        text: "var(--ant-orange-6)",
        border: "var(--ant-orange-3)",
    },
    yellow: {
        name: "yellow",
        bg: "var(--ant-yellow-1)",
        text: "var(--ant-yellow-6)",
        border: "var(--ant-yellow-3)",
    },
    volcano: {
        name: "volcano",
        bg: "var(--ant-volcano-1)",
        text: "var(--ant-volcano-6)",
        border: "var(--ant-volcano-3)",
    },
    geekblue: {
        name: "geekblue",
        bg: "var(--ant-geekblue-1)",
        text: "var(--ant-geekblue-6)",
        border: "var(--ant-geekblue-3)",
    },
    lime: {
        name: "lime",
        bg: "var(--ant-lime-1)",
        text: "var(--ant-lime-6)",
        border: "var(--ant-lime-3)",
    },
    gold: {
        name: "gold",
        bg: "var(--ant-gold-1)",
        text: "var(--ant-gold-6)",
        border: "var(--ant-gold-3)",
    },
}

const WORKFLOW_TYPE_PRESET_MAP = {
    chat: "blue",
    completion: "cyan",
    custom: "gold",
    auto_ai_critique: "purple",
    auto_custom_code_run: "gold",
    field_match_test: "blue",
    json_multi_field_match: "cyan",
    auto_json_diff: "volcano",
    auto_semantic_similarity: "geekblue",
    auto_webhook_test: "lime",
    auto_exact_match: "green",
    auto_contains_json: "magenta",
    auto_similarity_match: "pink",
    auto_regex_test: "orange",
    auto_starts_with: "yellow",
    auto_ends_with: "red",
    auto_contains: "orange",
    auto_contains_any: "purple",
    auto_contains_all: "gold",
    auto_levenshtein_distance: "lime",
    rag_faithfulness: "geekblue",
    rag_context_relevancy: "lime",
    ai_llm: "purple",
    llm: "purple",
    prompt: "purple",
    classifiers: "orange",
    match: "orange",
    similarity: "geekblue",
    functional: "volcano",
    hook: "volcano",
    code: "gold",
    human: "green",
    feedback: "green",
    rag: "lime",
} as const satisfies Record<string, PresetColorName>

export const WORKFLOW_TYPE_COLOR_MAP: Record<
    keyof typeof WORKFLOW_TYPE_PRESET_MAP,
    WorkflowTypeColor
> = Object.fromEntries(
    Object.entries(WORKFLOW_TYPE_PRESET_MAP).map(([key, preset]) => [
        key,
        PRESET_COLOR_MAP[preset],
    ]),
) as Record<keyof typeof WORKFLOW_TYPE_PRESET_MAP, WorkflowTypeColor>

const WORKFLOW_TYPE_LABEL_MAP: Record<keyof typeof WORKFLOW_TYPE_PRESET_MAP, string> = {
    chat: "Chat",
    completion: "Completion",
    custom: "Custom",
    auto_ai_critique: "AI Critique",
    auto_custom_code_run: "Custom Code",
    field_match_test: "Field Match",
    json_multi_field_match: "JSON Multi Field Match",
    auto_json_diff: "JSON Diff",
    auto_semantic_similarity: "Semantic Similarity",
    auto_webhook_test: "Webhook",
    auto_exact_match: "Exact Match",
    auto_contains_json: "Contains JSON",
    auto_similarity_match: "Similarity Match",
    auto_regex_test: "Regex Test",
    auto_starts_with: "Starts With",
    auto_ends_with: "Ends With",
    auto_contains: "Contains",
    auto_contains_any: "Contains Any",
    auto_contains_all: "Contains All",
    auto_levenshtein_distance: "Levenshtein Distance",
    rag_faithfulness: "RAG Faithfulness",
    rag_context_relevancy: "RAG Context Relevancy",
    ai_llm: "AI / LLM",
    llm: "LLM",
    prompt: "LLM",
    classifiers: "Classifiers",
    match: "Matchers",
    similarity: "Similarity",
    functional: "Functional",
    hook: "Webhook",
    code: "Custom Code",
    human: "Human",
    feedback: "Human",
    rag: "RAG",
}

export function normalizeWorkflowTypeKey(typeKey: string | null | undefined): string | null {
    if (!typeKey) return null
    const key = typeKey.includes(":") ? parseWorkflowKeyFromUri(typeKey) : typeKey
    const normalized = key
        ?.toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
    if (!normalized) return null
    if (normalized === "ai" || normalized === "ai_llm") return "ai_llm"
    if (normalized === "classifier") return "classifiers"
    if (normalized === "matcher") return "match"
    if (normalized === "webhooks" || normalized === "webhook") return "hook"
    return normalized
}

export function getWorkflowTypeColor(typeKey: string | null | undefined): WorkflowTypeColor | null {
    const normalized = normalizeWorkflowTypeKey(typeKey)
    if (!normalized) return null
    return WORKFLOW_TYPE_COLOR_MAP[normalized as keyof typeof WORKFLOW_TYPE_COLOR_MAP] ?? null
}

export function getWorkflowTypeLabel(typeKey: string | null | undefined): string | null {
    const normalized = normalizeWorkflowTypeKey(typeKey)
    if (!normalized) return null
    return WORKFLOW_TYPE_LABEL_MAP[normalized as keyof typeof WORKFLOW_TYPE_LABEL_MAP] ?? null
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
// FULL-PAGE PLAYGROUND CAPABILITY
// ============================================================================

/**
 * Legacy evaluator keys whose configuration benefits from a full-page
 * playground (prompt editor, code editor, model picker, etc.).
 *
 * The runtime handlers split into two shapes:
 * - **Prompt / code based** (`auto_ai_critique`, `llm`, `auto_custom_code_run`,
 *   `code`): the user authors a prompt template or evaluator code, both of
 *   which want the full-screen editing surface.
 * - **Declarative classifiers** (`auto_exact_match`, `auto_contains_*`,
 *   `auto_regex_test`, `match`, `json_multi_field_match`, …): a handful of
 *   form fields. The drawer is the right UX; the playground page wastes
 *   space and presents misleading envelope inputs.
 *
 * Only the former list lives here. Anything not matched falls back to the
 * drawer-only flow (see `Evaluators/index.tsx`).
 */
const FULL_PAGE_PLAYGROUND_KEYS = new Set([
    // Legacy keys
    "auto_ai_critique",
    "auto_custom_code_run",
    // Bare keys (auto_ prefix stripped)
    "ai_critique",
    "custom_code_run",
    // Canonical family keys (post-consolidation)
    "llm",
    "code",
])

/**
 * Determine whether an evaluator workflow has a full-page playground UX.
 *
 * Used to gate the post-create / row-click navigation in `Evaluators/index.tsx`
 * — declarative classifiers stay in the drawer-only flow because the playground
 * page can't offer them anything the drawer can't (no prompt, no code, no
 * model picker — just a few form fields the drawer already renders).
 *
 * Mirrors `isOnlineCapableEvaluator`: flag-first, then URI/metadata fallback.
 *
 * @param evaluator - Any object with optional `flags` and `data.uri` / `meta`
 * @returns `true` if the evaluator should open in the full-page playground
 */
export function hasFullPagePlaygroundUX(evaluator: {
    flags?: Record<string, unknown> | null
    data?: {uri?: string | null} | null
    meta?: Record<string, unknown> | null
    slug?: string | null
}): boolean {
    const flags = evaluator.flags
    if (flags?.is_llm || flags?.is_code) {
        return true
    }

    const uri = evaluator.data?.uri
    const keyFromUri = typeof uri === "string" ? parseWorkflowKeyFromUri(uri) : null
    const keyFromMeta =
        (evaluator.meta?.evaluator_key as string) ?? (evaluator.meta?.key as string) ?? null

    const candidates = collectEvaluatorCandidates(keyFromUri, keyFromMeta, evaluator.slug)
    return candidates.some((c) => FULL_PAGE_PLAYGROUND_KEYS.has(c))
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
