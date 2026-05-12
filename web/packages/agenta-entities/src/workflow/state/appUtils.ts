/**
 * App Utilities for Workflow Store
 *
 * Convenience atoms for application-type workflows.
 * Apps are workflows with `flags.is_application === true`.
 *
 * Provides:
 * - App template definitions query (chat / completion / custom catalog)
 * - Ephemeral app factory (local-* entity from a template, used by the
 *   new app-create drawer flow that mirrors evaluator-create)
 *
 * @packageDocumentation
 */

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {atom, getDefaultStore} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {generateLocalId} from "../../shared"
import type {WorkflowCatalogTemplate, WorkflowCatalogTemplatesResponse} from "../api"
import {fetchWorkflowCatalogTemplates, inspectWorkflow} from "../api"
import type {Workflow} from "../core"
import {buildWorkflowUri, parseWorkflowKeyFromUri} from "../core"

import {buildServiceUrlFromUri} from "./helpers"
import {workflowLocalServerDataAtomFamily} from "./store"

// ============================================================================
// TEMPLATES QUERY
// ============================================================================

/**
 * Query atom for application template definitions (chat, completion, custom).
 * Templates are static data (built-in app types), cached for 5 minutes.
 */
export const appTemplatesQueryAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)
    return {
        queryKey: ["appTemplates", projectId],
        queryFn: async (): Promise<WorkflowCatalogTemplatesResponse> => {
            if (!projectId) return {count: 0, templates: []}
            return fetchWorkflowCatalogTemplates({isApplication: true})
        },
        enabled: get(sessionAtom) && !!projectId,
        staleTime: 5 * 60_000,
        refetchOnWindowFocus: false,
    }
})

/**
 * Derived atom for the application templates data array.
 */
export const appTemplatesDataAtom = atom<WorkflowCatalogTemplate[]>((get) => {
    const query = get(appTemplatesQueryAtom)
    return query.data?.templates ?? []
})

// ============================================================================
// EPHEMERAL APP FACTORY
// ============================================================================

/**
 * App types supported by the drawer flow. "custom" routes through the
 * existing CustomWorkflowModal and does NOT use this factory.
 */
export type AppType = "chat" | "completion"

export interface CreateEphemeralAppFromTemplateParams {
    type: AppType
    defaultName?: string
    /** Optional abort signal — superseded by a newer click cancels the inflight call */
    signal?: AbortSignal
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/**
 * Match a template to the requested app type. The catalog returns templates
 * with `data.uri` like `agenta:builtin:chat:v0` (provider:kind:key:version).
 * We extract the key segment via `parseWorkflowKeyFromUri` and compare
 * against the requested type. Falls back to comparing `t.key` directly
 * (which may be `"chat"`, `"SERVICE:chat"`, or the catalog key).
 */
function matchTemplateForType(
    templates: WorkflowCatalogTemplate[],
    type: AppType,
): WorkflowCatalogTemplate | null {
    const lowerType = type.toLowerCase()
    return (
        templates.find((t) => {
            const uriKey = parseWorkflowKeyFromUri(t.data?.uri)?.toLowerCase() ?? null
            if (uriKey === lowerType) return true
            const rawKey = t.key?.toLowerCase() ?? ""
            // Strip a `service:` prefix if present (e.g. `SERVICE:chat` → `chat`).
            const normalizedKey = rawKey.startsWith("service:") ? rawKey.slice(8) : rawKey
            return normalizedKey === lowerType
        }) ?? null
    )
}

/**
 * Create a local-only application workflow entity from a built-in catalog
 * template (chat or completion). Mirrors `createEvaluatorFromTemplate` —
 * fetches the parameter schema via the inspect endpoint, merges with template
 * defaults, and stores the entity in the local atom family.
 *
 * The returned `local-*` ID is immediately usable via `workflowEntityAtomFamily(id)`.
 * On commit (via `createWorkflowFromEphemeralAtom`), the ephemeral is promoted
 * to a real app + variant + v1 in one server call — flags flow transitively
 * (`flags.is_application: true` is set here, read at commit time).
 *
 * Pure entity-lifecycle function — no UI/router dependencies.
 *
 * @returns The local entity ID, or null if the template was not found,
 *          the project is not set, or the call was aborted via the signal.
 */
export async function createEphemeralAppFromTemplate({
    type,
    defaultName,
    signal,
}: CreateEphemeralAppFromTemplateParams): Promise<string | null> {
    if (signal?.aborted) return null

    const store = getDefaultStore()
    const projectId = store.get(projectIdAtom)

    if (!projectId) return null

    // Read cached templates first (fast path — atom may already be populated
    // by a mounted dropdown). Fall back to a direct fetch if empty.
    let templates = store.get(appTemplatesDataAtom)
    if (templates.length === 0) {
        try {
            const response = await fetchWorkflowCatalogTemplates({isApplication: true})
            if (signal?.aborted) return null
            templates = response.templates ?? []
        } catch {
            return null
        }
    }

    const template = matchTemplateForType(templates, type)
    if (!template) return null

    if (signal?.aborted) return null

    // Fall back to building the URI from the requested `type` (e.g. "chat",
    // "completion") rather than `template.key`. The catalog can return keys
    // like `SERVICE:chat` (matched via `matchTemplateForType`) which would
    // produce an invalid builtin URI when fed straight into `buildWorkflowUri`.
    const uri = template.data?.uri ?? buildWorkflowUri(type)
    const localId = generateLocalId("local")
    const resolvedName = defaultName ?? `${capitalize(type)} prompt`

    const catalogSchemas = template.data?.schemas as
        | Record<string, Record<string, unknown> | null | undefined>
        | undefined
    let schemas: {
        inputs?: Record<string, unknown> | null
        outputs?: Record<string, unknown> | null
        parameters?: Record<string, unknown> | null
    } = {
        inputs: (catalogSchemas?.inputs as Record<string, unknown> | undefined) ?? null,
        outputs: (catalogSchemas?.outputs as Record<string, unknown> | undefined) ?? null,
        parameters: (catalogSchemas?.parameters as Record<string, unknown> | undefined) ?? null,
    }

    // Resolve schemas from inspect — best-effort. If it fails or aborts,
    // fall back to catalog schemas above.
    try {
        const serviceUrl = buildServiceUrlFromUri(uri)
        const inspectData = await inspectWorkflow(uri, projectId, serviceUrl)
        if (signal?.aborted) return null
        const inspectSchemas = inspectData?.revision?.schemas ?? inspectData?.interface?.schemas
        if (inspectSchemas) {
            schemas = {
                inputs: inspectSchemas.inputs ?? schemas.inputs,
                outputs: inspectSchemas.outputs ?? schemas.outputs,
                parameters: inspectSchemas.parameters ?? schemas.parameters,
            }
        }
    } catch {
        // Inspect failed — proceed with catalog schemas (or empty).
    }

    if (signal?.aborted) return null

    const parameters: Record<string, unknown> = {
        ...((template.data?.parameters as Record<string, unknown> | undefined) ?? {}),
    }

    const workflow: Workflow = {
        id: localId,
        name: resolvedName,
        slug: null,
        version: null,
        flags: {
            is_managed: false,
            is_custom: false,
            is_llm: true,
            is_hook: false,
            is_code: false,
            is_match: false,
            is_feedback: false,
            is_chat: type === "chat",
            has_url: false,
            has_script: false,
            has_handler: false,
            is_application: true,
            is_evaluator: false,
            is_snippet: false,
            is_base: false,
        },
        data: {
            uri,
            parameters,
            schemas,
        },
        meta: {
            __ephemeral: true,
            templateKey: template.key,
            defaultName: resolvedName,
        },
    } as Workflow

    store.set(workflowLocalServerDataAtomFamily(localId), workflow)

    return localId
}
