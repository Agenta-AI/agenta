/**
 * Evaluator Templates API
 *
 * Fetches the static evaluator template definitions from the backend.
 * Templates provide the `key → display name` mapping used for colored badges.
 *
 * Endpoint: `GET /preview/simple/evaluators/templates`
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorTemplate {
    name: string
    key: string
    direct_use: boolean
    settings_template: Record<string, unknown>
    outputs_schema?: Record<string, unknown> | null
    description?: string | null
    oss?: boolean
    requires_llm_api_keys?: boolean
    tags: string[]
    archived?: boolean
}

export interface EvaluatorTemplatesResponse {
    count: number
    templates: EvaluatorTemplate[]
}

// ============================================================================
// API FUNCTION
// ============================================================================

/**
 * Fetch evaluator templates (static definitions).
 *
 * These are the built-in evaluator type definitions that provide
 * `key` and `name` for display in pickers and badges.
 *
 * @param projectId - Project ID
 * @param includeArchived - Whether to include archived templates
 * @returns Templates response with count and templates array
 */
export async function fetchEvaluatorTemplates(
    projectId: string,
    includeArchived = false,
): Promise<EvaluatorTemplatesResponse> {
    if (!projectId) {
        return {count: 0, templates: []}
    }

    const response = await axios.get<EvaluatorTemplatesResponse>(
        `${getAgentaApiUrl()}/preview/simple/evaluators/templates`,
        {params: {project_id: projectId, include_archived: includeArchived}},
    )

    return response.data ?? {count: 0, templates: []}
}
