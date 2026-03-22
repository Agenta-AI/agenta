/**
 * Create a workflow app from a catalog template or custom service URL.
 *
 * This encapsulates the core creation logic:
 * 1. Resolve the catalog template (get URI, default parameters, schemas)
 * 2. Create the workflow via `POST /workflows` with template data
 *
 * For custom apps with a service URL, the workflow is created with the URL
 * and no template data — the schema is fetched on first playground load.
 *
 * This function is framework-agnostic (no Router, no Jotai) — the caller
 * handles navigation and UI status updates.
 */

import {generateId} from "@agenta/shared/utils"

import {extractVariablesFromConfig} from "../../runnable/utils"

import {
    createWorkflow,
    fetchWorkflowCatalogTemplates,
    type CreateWorkflowPayload,
    type WorkflowCatalogTemplate,
} from "./api"

// ============================================================================
// Types
// ============================================================================

export enum AppServiceType {
    Completion = "completion",
    Chat = "chat",
    Custom = "CUSTOM",
}

export interface CreateAppFromTemplateParams {
    projectId: string
    organizationId?: string
    workspaceId?: string
    appName: string
    templateKey: string
    serviceUrl?: string
    folderId?: string | null
    isCustomWorkflow?: boolean
    /** Called after the workflow is created and before configuration begins */
    onConfiguring?: () => void
}

export interface CreateAppFromTemplateResult {
    appId: string
    revisionId?: string
}

// ============================================================================
// Default parameter extraction from catalog template schemas
// ============================================================================

/**
 * Extract default parameter values from a catalog template's parameter schema.
 *
 * The catalog template provides `data.schemas.parameters` as a JSON Schema
 * with `default` values on properties. This function collects those defaults
 * into a flat parameters object suitable for committing as the initial revision.
 */
function extractDefaultsFromSchema(
    schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
    if (!schema) return {}

    // Check for a top-level default (Pydantic models emit this)
    if (schema.default && typeof schema.default === "object") {
        return schema.default as Record<string, unknown>
    }

    // Collect individual property defaults
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
    if (!properties) return {}

    const defaults: Record<string, unknown> = {}
    for (const [key, prop] of Object.entries(properties)) {
        if (prop?.default !== undefined) {
            defaults[key] = prop.default
        }
    }
    return defaults
}

/**
 * Clean up raw defaults extracted from the catalog schema.
 *
 * The `PromptTemplate` model includes legacy fields (`system_prompt`,
 * `user_prompt`) and optional fields (`tools`) that may need normalization.
 */
function cleanupDefaultParameters(params: Record<string, unknown>): Record<string, unknown> {
    const cleaned = {...params}

    for (const [key, value] of Object.entries(cleaned)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue
        const config = value as Record<string, unknown>

        const hasMessages = Array.isArray(config.messages)
        const hasLlmConfig = config.llm_config && typeof config.llm_config === "object"

        if (!hasMessages && !hasLlmConfig) continue

        // Remove legacy fields
        delete config.system_prompt
        delete config.user_prompt

        // Ensure llm_config.tools is an empty array when absent/null
        if (hasLlmConfig) {
            const llmConfig = config.llm_config as Record<string, unknown>
            if (!Array.isArray(llmConfig.tools)) {
                llmConfig.tools = []
            }
        }

        // Extract input_keys from message templates
        if (hasMessages && !config.input_keys) {
            const variables = extractVariablesFromConfig({[key]: config})
            if (variables.length > 0) {
                config.input_keys = variables
            }
        }
    }

    return cleaned
}

// ============================================================================
// Template key → catalog template mapping
// ============================================================================

/** Map legacy SERVICE:xxx keys to catalog template keys */
function normalizeCatalogKey(templateKey: string): string {
    if (templateKey.startsWith("SERVICE:")) {
        return templateKey.replace("SERVICE:", "")
    }
    return templateKey
}

// ============================================================================
// Core creation function
// ============================================================================

/**
 * Create a workflow app from a catalog template or custom service URL.
 *
 * Steps:
 * 1. Resolve the catalog template to get URI, schemas, and default parameters
 * 2. Create the workflow with a variant and committed revision via the workflow API
 *
 * @returns `{ appId, revisionId? }` — revisionId is set when auto-commit succeeds
 * @throws On workflow creation failure
 */
export async function createAppFromTemplate({
    projectId,
    appName,
    templateKey,
    serviceUrl,
    folderId,
    isCustomWorkflow = false,
    onConfiguring,
}: CreateAppFromTemplateParams): Promise<CreateAppFromTemplateResult> {
    const catalogKey = normalizeCatalogKey(templateKey)

    // Step 1: Resolve template from catalog (unless custom URL)
    let template: WorkflowCatalogTemplate | null = null
    let uri: string | undefined
    let defaultParameters: Record<string, unknown> = {}
    let schemas: Record<string, unknown> | undefined

    if (!isCustomWorkflow && catalogKey !== "CUSTOM") {
        const catalogResponse = await fetchWorkflowCatalogTemplates({isApplication: true})
        template = catalogResponse.templates.find((t) => t.key === catalogKey) ?? null

        if (!template) {
            throw new Error(`[createAppFromTemplate] Template "${catalogKey}" not found in catalog`)
        }

        uri = template.data?.uri
        schemas = template.data?.schemas as Record<string, unknown> | undefined

        // Extract and clean default parameters from the template schema
        const parametersSchema = template.data?.schemas?.parameters as
            | Record<string, unknown>
            | undefined
        const rawDefaults = extractDefaultsFromSchema(parametersSchema)
        defaultParameters = cleanupDefaultParameters(rawDefaults)
    }

    onConfiguring?.()

    // Step 2: Create workflow with template data
    const isChat = catalogKey === "chat" || !!template?.data?.uri?.includes(":chat:")
    const slug = generateId().replace(/-/g, "").slice(0, 12)

    const workflow = await createWorkflow(projectId, {
        slug,
        name: appName,
        flags: {
            is_chat: isChat,
            is_evaluator: false,
            is_custom: isCustomWorkflow || catalogKey === "CUSTOM",
            is_human: false,
        } as CreateWorkflowPayload["flags"],
        data: {
            uri: uri ?? undefined,
            url: serviceUrl ?? undefined,
            parameters: Object.keys(defaultParameters).length > 0 ? defaultParameters : undefined,
            schemas: schemas ?? undefined,
        },
        meta: folderId ? {folder_id: folderId} : undefined,
        message: "Initial commit from template",
    })

    return {
        appId: workflow.id,
        revisionId: workflow.id, // createWorkflow returns the revision on success
    }
}
