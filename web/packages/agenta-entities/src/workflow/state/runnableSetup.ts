/**
 * Workflow Runnable Extension
 *
 * Provides runnable extension atoms for workflow entities.
 * These atoms extend the workflow molecule with runnable-specific functionality
 * so workflows can be used in the playground package.
 *
 * ## Key difference from evaluator
 *
 * Workflows support both chat and completion execution modes based on
 * the `flags.is_chat` flag. Evaluators always use "completion" mode.
 *
 * ## Runnable Interface Contract
 *
 * The playground package expects runnables to provide:
 * - **invocationUrl**: URL to invoke the workflow
 * - **inputPorts**: Input port definitions (from schemas.inputs)
 * - **outputPorts**: Output port definitions (from schemas.outputs)
 * - **configuration**: Workflow parameters
 * - **executionMode**: "chat" or "completion" based on flags.is_chat
 *
 * ## Workflow Invocation
 *
 * Workflows can be invoked via:
 * - Custom URL: `data.url` (webhook/custom endpoint)
 * - Native: `POST /preview/workflows/invoke` (uses URI from data.uri)
 * - Evaluator legacy: `POST /evaluators/{key}/run/` (if flags.is_evaluator && uri)
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {flattenEvaluatorConfiguration} from "../../runnable/evaluatorTransforms"
import type {RequestPayloadData} from "../../runnable/types"
import {extractVariablesFromConfig} from "../../runnable/utils"
import type {StoreOptions} from "../../shared"
import {parseRevisionUri} from "../../shared"

import {resolveBuiltinAppServiceUrl} from "./helpers"
import {
    workflowAppSchemaAtomFamily,
    workflowEntityAtomFamily,
    workflowServiceSchemaForRevisionAtomFamily,
} from "./store"

// Re-export for external consumers
export {resolveBuiltinAppServiceUrl} from "./helpers"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
}

function extractSchemaInputKeys(schema: unknown): string[] {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) return []

    const properties = (schema as Record<string, unknown>).properties
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return []

    return Object.keys(properties as Record<string, unknown>).filter((key) => key.length > 0)
}

function extractInputKeysFromConfigInputKeys(agConfig: Record<string, unknown>): string[] {
    const variables: string[] = []
    for (const val of Object.values(agConfig)) {
        const valRecord = val as Record<string, unknown> | null
        if (!valRecord || typeof valRecord !== "object") continue
        if (!("input_keys" in valRecord)) continue

        const keys = valRecord.input_keys
        if (!Array.isArray(keys)) continue
        for (const k of keys) {
            if (typeof k === "string" && !variables.includes(k)) {
                variables.push(k)
            }
        }
    }
    return variables
}

// ============================================================================
// EXECUTION MODE
// ============================================================================

/**
 * Execution mode for workflows.
 * Determined by `flags.is_chat`: true → "chat", false → "completion".
 */
export const executionModeAtomFamily = atomFamily((workflowId: string) =>
    atom<"chat" | "completion">((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.flags?.is_chat ? "chat" : "completion"
    }),
)

// ============================================================================
// APP WORKFLOW SCHEMA SELECTORS
// ============================================================================

/**
 * Route path derived from the app schema.
 * Prefers the prefetched service schema for builtin apps (completion/chat),
 * falls back to per-revision OpenAPI fetch for custom apps.
 */
export const appRoutePathAtomFamily = atomFamily((workflowId: string) =>
    atom<string>((get) => {
        const serviceResult = get(workflowServiceSchemaForRevisionAtomFamily(workflowId))
        if (serviceResult.isServiceType) {
            return serviceResult.schemas?.routePath || ""
        }
        const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
        return appSchemaQuery.data?.routePath || ""
    }),
)

/**
 * Raw dereferenced OpenAPI spec from the app schema.
 * Prefers the prefetched service schema for builtin apps (completion/chat),
 * falls back to per-revision OpenAPI fetch for custom apps.
 * Needed by `buildRequestBody()` for input mapping and custom workflow detection.
 */
export const appOpenApiSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<unknown | null>((get) => {
        const serviceResult = get(workflowServiceSchemaForRevisionAtomFamily(workflowId))
        if (serviceResult.isServiceType) {
            return serviceResult.schemas?.openApiSchema ?? null
        }
        const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
        return appSchemaQuery.data?.openApiSchema ?? null
    }),
)

// ============================================================================
// INVOCATION URL
// ============================================================================

/**
 * Invocation URL for workflow execution.
 *
 * All workflow types (app, evaluator, custom) use the unified
 * `POST /preview/workflows/invoke` endpoint. The backend resolves
 * the handler via the `interface` field in the request body.
 *
 * Exceptions:
 * - **Evaluator workflows** with `data.url` (webhook): URL as-is
 * - **Custom app workflows** with `data.url` but no `data.uri`: legacy `/test` path
 */
export const invocationUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const isEvaluator = entity.flags?.is_evaluator ?? false
        const isCustom = entity.flags?.is_custom ?? false

        // Evaluator workflows with URL (webhook): return URL as-is
        if (entity.data.url && isEvaluator) {
            return entity.data.url
        }

        // Custom app workflows without URI: legacy /test path
        // These are user-hosted services that don't go through the SDK invoke endpoint.
        if (isCustom && entity.data.url && !entity.data.uri) {
            const resolvedBuiltinUrl = resolveBuiltinAppServiceUrl(entity)
            const effectiveAppUrl = resolvedBuiltinUrl ?? entity.data.url
            const routePath = get(appRoutePathAtomFamily(workflowId))
            const parsed = effectiveAppUrl ? parseRevisionUri(effectiveAppUrl) : null
            if (!parsed) return `${effectiveAppUrl}/test`

            const apiUrl = getAgentaApiUrl()
            const currentOrigin = apiUrl ? apiUrl.replace(/\/api\/?$/, "") : null
            const storedOrigin = parsed.runtimePrefix.replace(/\/$/, "")
            const prefix =
                currentOrigin && currentOrigin !== storedOrigin ? currentOrigin : storedOrigin
            const cleanRoutePath = (routePath || parsed.routePath || "")
                .replace(/^\//, "")
                .replace(/\/$/, "")

            if (cleanRoutePath) {
                return `${prefix}/${cleanRoutePath}/test`
            }
            return `${prefix}/test`
        }

        // All other workflows: unified invoke endpoint
        // The backend resolves the handler via interface.uri or interface.url
        if (entity.data.uri || entity.data.url) {
            return `${getAgentaApiUrl()}/preview/workflows/invoke`
        }

        return null
    }),
)

/**
 * Deployment URL for code snippets and external API usage.
 *
 * Unlike `invocationUrlAtomFamily` (used for playground execution via the
 * unified invoke endpoint), this returns the user-facing service URL with
 * `/run` suffix that resolves config from deployed environments.
 *
 * Used by the deployment dashboard to generate code snippets.
 */
export const deploymentUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const resolvedBuiltinUrl = resolveBuiltinAppServiceUrl(entity)
        const effectiveAppUrl = resolvedBuiltinUrl ?? entity.data.url
        if (!effectiveAppUrl) return null

        const routePath = get(appRoutePathAtomFamily(workflowId))
        const parsed = parseRevisionUri(effectiveAppUrl)
        if (!parsed) return `${effectiveAppUrl}/run`

        const apiUrl = getAgentaApiUrl()
        const currentOrigin = apiUrl ? apiUrl.replace(/\/api\/?$/, "") : null
        const storedOrigin = parsed.runtimePrefix.replace(/\/$/, "")
        const prefix =
            currentOrigin && currentOrigin !== storedOrigin ? currentOrigin : storedOrigin
        const cleanRoutePath = (routePath || parsed.routePath || "")
            .replace(/^\//, "")
            .replace(/\/$/, "")

        if (cleanRoutePath) {
            return `${prefix}/${cleanRoutePath}/run`
        }
        return `${prefix}/run`
    }),
)

// ============================================================================
// SCHEMA SELECTORS
// ============================================================================

/**
 * Input schema for the workflow.
 * Derived from `data.schemas.inputs`.
 */
export const inputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return (entity?.data?.schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema for the workflow.
 * Derived from `data.schemas.outputs`.
 */
export const outputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return (entity?.data?.schemas?.outputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Parameters schema for the workflow.
 * Derived from `data.schemas.parameters`.
 */
export const parametersSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
    }),
)

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Workflow configuration (parameters).
 * Falls back to legacy `data.configuration` field.
 */
export const configurationAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.data?.parameters ?? entity?.data?.configuration ?? null
    }),
)

// ============================================================================
// URI
// ============================================================================

/**
 * Workflow URI for native invocation.
 * Example: "agenta:builtin:auto_exact_match:v0"
 */
export const workflowUriAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return entity?.data?.uri ?? null
    }),
)

// ============================================================================
// REQUEST PAYLOAD
// ============================================================================

/**
 * Request payload for workflow execution.
 *
 * - **Evaluator workflows** use the `{interface, configuration, data}` format
 *   (`__rawBody: true`) for `/preview/workflows/invoke`.
 * - **App workflows** (non-custom with URI) use `__rawBody` with `__appWorkflow`
 *   marker. The execution pipeline builds inputs via `buildRequestBody()` then
 *   wraps them into the invoke format. Metadata needed for `buildRequestBody()`
 *   is passed in `__meta`.
 * - **Custom app workflows** (no URI, user-hosted) return `RequestPayloadData`
 *   for the legacy `buildRequestBody()` → `/test` endpoint path.
 * - **Ephemeral (base) workflows** return `RequestPayloadData` for trace replay.
 */
export const requestPayloadAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | RequestPayloadData | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const isEvaluator = entity.flags?.is_evaluator ?? false
        const isBase = entity.flags?.is_base ?? false

        // ── Ephemeral (base) workflows: build payload from trace data ──
        if (isBase) {
            const isChat = entity.flags?.is_chat ?? false
            const params = entity.data.parameters as Record<string, unknown>
            const runtimePrefix = isChat ? "services/chat" : "services/completion"

            // Extract variables from parameters (input_keys from prompt configs)
            const variables: string[] = []
            for (const value of Object.values(params)) {
                if (value && typeof value === "object") {
                    const nested = value as Record<string, unknown>
                    if (Array.isArray(nested.input_keys)) {
                        for (const k of nested.input_keys) {
                            if (typeof k === "string" && !variables.includes(k)) {
                                variables.push(k)
                            }
                        }
                    }
                }
            }

            // Fallback: use trace input keys from meta
            if (variables.length === 0) {
                const meta = entity.meta as Record<string, unknown> | null | undefined
                const inputs = meta?.inputs as Record<string, unknown> | undefined
                if (inputs) {
                    for (const key of Object.keys(inputs)) {
                        if (isChat && key === "messages") continue
                        variables.push(key)
                    }
                }
            }

            // Build references from meta.sourceRef for trace attribution
            const meta = entity.meta as Record<string, unknown> | null | undefined
            const sourceRef = meta?.sourceRef as
                | {type?: string; id?: string; slug?: string}
                | undefined
            const references: Record<string, {id?: string; slug?: string}> = {}
            if (sourceRef?.id) {
                const refType = sourceRef.type ?? "application"
                references[refType] = {
                    id: sourceRef.id,
                    ...(sourceRef.slug ? {slug: sourceRef.slug} : {}),
                }
            }

            return {
                ag_config: params,
                isChat,
                appType: isChat ? "chat" : "completion",
                invocationUrl: null,
                runtimePrefix,
                variables,
                spec: null,
                routePath: undefined,
                isCustom: false,
                appId: sourceRef?.id ?? null,
                references: Object.keys(references).length > 0 ? references : undefined,
            } satisfies RequestPayloadData
        }

        // ── Evaluator workflows: use __rawBody format ──
        // The entity store may hold nested params (prompt.messages format) from
        // the UI nesting transform or from v3+ evaluators that store nested natively.
        // The backend invoke endpoint expects flat params (prompt_template format),
        // so we flatten before building the request body.
        if (isEvaluator) {
            const uri = entity.data.uri
            const url = entity.data.url
            if (!uri && !url) return null

            const rawParams = (entity.data.parameters ?? entity.data.configuration ?? {}) as Record<
                string,
                unknown
            >
            const parameters = flattenEvaluatorConfiguration(rawParams, null)
            return {
                __rawBody: true,
                interface: uri ? {uri} : {url},
                configuration:
                    parameters && Object.keys(parameters).length > 0 ? {parameters} : undefined,
                data: {
                    inputs: {},
                    outputs: {},
                    parameters,
                },
            }
        }

        // ── App workflows ──
        const isChat = entity.flags?.is_chat ?? false
        const isCustom = entity.flags?.is_custom ?? false
        const openApiSchema = get(appOpenApiSchemaAtomFamily(workflowId))
        const routePath = get(appRoutePathAtomFamily(workflowId))

        // --- Builtin app URL resolution (migration fix) ---
        // Use corrected URL for builtin apps with stale data.url.
        // TODO: Remove once backend migration is complete.
        const resolvedUrl = resolveBuiltinAppServiceUrl(entity)
        const effectiveUrl = resolvedUrl ?? entity.data.url
        const parsed = effectiveUrl ? parseRevisionUri(effectiveUrl) : null

        // Extract ag_config from parameters
        const params = entity.data.parameters as Record<string, unknown> | undefined
        const agConfig = (params?.ag_config as Record<string, unknown>) || params || {}

        // Primary source of truth follows workflow input-port logic:
        // 1) schema input keys, 2) prompt-template variables.
        // Final fallback: persisted input_keys from ag_config.
        const schemaVariables = extractSchemaInputKeys(entity.data?.schemas?.inputs)
        const promptVariables =
            schemaVariables.length > 0 ? [] : extractVariablesFromConfig(agConfig)
        const variables = Array.from(new Set([...schemaVariables, ...promptVariables]))

        if (variables.length === 0) {
            try {
                variables.push(...extractInputKeysFromConfigInputKeys(agConfig))
            } catch {
                // best-effort
            }
        }

        // Build references used by execution + tracing.
        const appId = entity.workflow_id ?? null
        const variantId = entity.workflow_variant_id ?? entity.variant_id ?? null
        const references: Record<string, Record<string, string | undefined>> = {}
        if (appId) {
            references.application = {id: appId}
        }
        if (variantId) {
            references.application_variant = {id: variantId}
        }
        if (entity.id) {
            references.application_revision = {id: entity.id}
        }

        // Custom app workflows without URI: legacy RequestPayloadData format
        // for buildRequestBody() → /test endpoint path.
        if (isCustom && !entity.data.uri) {
            const invocationUrl = get(invocationUrlAtomFamily(workflowId))
            return {
                ag_config: agConfig,
                isChat,
                appType: null,
                invocationUrl,
                runtimePrefix: parsed?.runtimePrefix ?? null,
                variables,
                spec: openApiSchema,
                routePath: routePath || undefined,
                isCustom: true,
                appId,
                references: Object.keys(references).length > 0 ? references : undefined,
            } satisfies RequestPayloadData
        }

        // Standard app workflows: use __rawBody format for /preview/workflows/invoke.
        // The interface field tells the backend which handler to resolve.
        // Configuration carries the ag_config (prompt configs, LLM settings).
        // data.inputs will be populated at execution time by buildExecutionItem.
        const uri = entity.data.uri
        const url = entity.data.url
        return {
            __rawBody: true,
            __appWorkflow: true, // Marker for buildExecutionItem to apply app-specific transforms
            interface: uri ? {uri} : url ? {url} : {},
            configuration:
                agConfig && Object.keys(agConfig).length > 0 ? {parameters: agConfig} : undefined,
            data: {
                inputs: {},
            },
            references: Object.keys(references).length > 0 ? references : undefined,
            // Pass through metadata needed by execution pipeline
            __meta: {
                isChat,
                variables,
                spec: openApiSchema,
                routePath: routePath || undefined,
                runtimePrefix: parsed?.runtimePrefix ?? null,
                appId,
                agConfig,
            },
        }
    }),
)

// ============================================================================
// RUNNABLE EXTENSION EXPORTS
// ============================================================================

/**
 * Runnable atoms collection for workflow entities.
 */
export const runnableAtoms = {
    executionMode: executionModeAtomFamily,
    invocationUrl: invocationUrlAtomFamily,
    deploymentUrl: deploymentUrlAtomFamily,
    inputSchema: inputSchemaAtomFamily,
    outputSchema: outputSchemaAtomFamily,
    parametersSchema: parametersSchemaAtomFamily,
    configuration: configurationAtomFamily,
    uri: workflowUriAtomFamily,
    requestPayload: requestPayloadAtomFamily,
}

/**
 * Runnable imperative get API.
 */
export const runnableGet = {
    executionMode: (workflowId: string, options?: StoreOptions) =>
        getStore(options).get(executionModeAtomFamily(workflowId)),
    invocationUrl: (workflowId: string, options?: StoreOptions) =>
        getStore(options).get(invocationUrlAtomFamily(workflowId)),
    deploymentUrl: (workflowId: string, options?: StoreOptions) =>
        getStore(options).get(deploymentUrlAtomFamily(workflowId)),
    configuration: (workflowId: string, options?: StoreOptions) =>
        getStore(options).get(configurationAtomFamily(workflowId)),
    uri: (workflowId: string, options?: StoreOptions) =>
        getStore(options).get(workflowUriAtomFamily(workflowId)),
}

/**
 * Workflow runnable extension — provides all runnable-related atoms
 * for integration with the playground bridge.
 */
export const workflowRunnableExtension = {
    atoms: runnableAtoms,
    get: runnableGet,
}
