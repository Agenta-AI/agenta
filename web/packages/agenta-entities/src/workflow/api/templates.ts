/**
 * Evaluator Catalog API
 *
 * Fetches evaluator catalog templates and presets from the new catalog endpoints.
 * Templates provide the `key → display name` mapping used for colored badges,
 * plus `data.schemas` for parameter/output JSON Schemas and `data.uri` for the
 * builtin URI.
 *
 * Endpoints:
 * - `GET /preview/evaluators/catalog/templates`
 * - `GET /preview/evaluators/catalog/templates/{template_key}/presets`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

// ============================================================================
// CATALOG TYPES
// ============================================================================

/**
 * Catalog template as returned by `GET /preview/evaluators/catalog/templates`.
 *
 * Replaces the legacy `EvaluatorTemplate` shape.
 * Key differences:
 * - `categories` replaces `tags`
 * - `data.uri` is explicit (no longer derived client-side)
 * - `data.schemas.parameters` is already JSON Schema (no `settings_template` metadata)
 * - `data.schemas.outputs` replaces top-level `outputs_schema`
 * - No `settings_presets` — presets are fetched separately
 * - No `direct_use`, `requires_llm_api_keys`, `oss` — not catalog concerns
 */
export interface EvaluatorCatalogTemplate {
    key: string
    name?: string | null
    description?: string | null
    archived?: boolean | null
    recommended?: boolean | null
    categories?: string[] | null
    data?: {
        uri?: string
        schemas?: {
            parameters?: Record<string, unknown>
            outputs?: Record<string, unknown>
        }
    } | null
}

export interface EvaluatorCatalogTemplatesResponse {
    count: number
    templates: EvaluatorCatalogTemplate[]
}

/**
 * Catalog preset as returned by
 * `GET /preview/evaluators/catalog/templates/{template_key}/presets`.
 */
export interface EvaluatorCatalogPreset {
    key: string
    name?: string | null
    description?: string | null
    archived?: boolean | null
    recommended?: boolean | null
    categories?: string[] | null
    data?: {
        uri?: string
        parameters?: Record<string, unknown>
    } | null
}

export interface EvaluatorCatalogPresetsResponse {
    count: number
    presets: EvaluatorCatalogPreset[]
}

// ============================================================================
// BACKWARD-COMPAT RE-EXPORT
// ============================================================================

/**
 * @deprecated Use `EvaluatorCatalogTemplate` instead.
 * Kept temporarily so downstream imports don't break during migration.
 */
export type EvaluatorTemplate = EvaluatorCatalogTemplate

/**
 * @deprecated Use `EvaluatorCatalogTemplatesResponse` instead.
 */
export type EvaluatorTemplatesResponse = EvaluatorCatalogTemplatesResponse

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch evaluator catalog templates.
 *
 * These are the built-in evaluator type definitions that provide
 * `key` and `name` for display in pickers and badges, plus `data.schemas`
 * and `data.uri` for schema resolution and entity creation.
 */
export async function fetchEvaluatorTemplates(
    projectId: string,
    includeArchived = false,
): Promise<EvaluatorCatalogTemplatesResponse> {
    if (!projectId) {
        return {count: 0, templates: []}
    }

    const response = await axios.get<EvaluatorCatalogTemplatesResponse>(
        `${getAgentaApiUrl()}/preview/evaluators/catalog/templates`,
        {params: {project_id: projectId, include_archived: includeArchived}},
    )

    return response.data ?? {count: 0, templates: []}
}

/**
 * Fetch presets for a specific evaluator catalog template.
 *
 * Presets contain pre-filled parameter values that can be applied
 * to an evaluator configuration.
 */
export async function fetchEvaluatorCatalogPresets(
    projectId: string,
    templateKey: string,
): Promise<EvaluatorCatalogPresetsResponse> {
    if (!projectId || !templateKey) {
        return {count: 0, presets: []}
    }

    const response = await axios.get<EvaluatorCatalogPresetsResponse>(
        `${getAgentaApiUrl()}/preview/evaluators/catalog/templates/${encodeURIComponent(templateKey)}/presets`,
        {params: {project_id: projectId}},
    )

    return response.data ?? {count: 0, presets: []}
}
