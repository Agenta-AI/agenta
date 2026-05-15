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
 * All workflow types (apps and evaluators) are invoked via:
 * - `POST {serviceUrl}/invoke` (service URL from data.url or built from data.uri)
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import {
    flattenEvaluatorConfiguration,
    nestEvaluatorSchema,
} from "../../runnable/evaluatorTransforms"
import type {RequestPayloadData} from "../../runnable/types"
import {extractVariablesFromConfig} from "../../runnable/utils"
import type {StoreOptions} from "../../shared"
import {isLocalDraftId, parseRevisionUri} from "../../shared"
import {
    resolveInputSchema,
    resolveOutputSchema,
    resolveParameters,
    resolveParametersSchema,
} from "../core/schema"

import {buildServiceUrlFromUri, resolveBuiltinAppServiceUrl} from "./helpers"
import {
    workflowAppSchemaAtomFamily,
    workflowBaseEntityAtomFamily,
    workflowEntityAtomFamily,
    workflowIsDirtyAtomFamily,
    workflowLocalServerDataAtomFamily,
    getFlatSourceData,
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
 *
 * Checks in order:
 * 1. `flags.is_chat` — explicit flag from the backend
 * 2. `data.schemas.inputs` — if the input schema has a `messages` property,
 *    the workflow is a chat app (the flag may lag behind the schema data)
 */
export const executionModeAtomFamily = atomFamily((workflowId: string) =>
    atom<"chat" | "completion">((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        if (entity?.flags?.is_chat) return "chat"

        // Fallback: detect chat mode from input schema.
        // Only the INPUT schema (not the parameters schema) distinguishes chat from
        // completion — chat apps accept `messages` as input, while completion apps
        // have prompt template messages in parameters but take simple variables as input.
        const inputSchema = entity?.data?.schemas?.inputs as
            | Record<string, unknown>
            | null
            | undefined
        const inputProps = inputSchema?.properties as Record<string, unknown> | null | undefined
        if (inputProps?.messages) return "chat"

        return "completion"
    }),
)

// ============================================================================
// APP WORKFLOW SCHEMA SELECTORS
// ============================================================================

/**
 * Route path derived from the app schema.
 * Only populated for legacy custom apps (no URI) that use the OpenAPI fallback.
 * Workflows with URIs use the unified invoke endpoint and don't need a route path.
 */
export const appRoutePathAtomFamily = atomFamily((workflowId: string) =>
    atom<string>((get) => {
        const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
        return appSchemaQuery.data?.routePath || ""
    }),
)

/**
 * Raw dereferenced OpenAPI spec from the app schema.
 * Only populated for legacy custom apps (no URI) that use the OpenAPI fallback.
 * Needed by `buildRequestBody()` for legacy input mapping.
 */
export const appOpenApiSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<unknown | null>((get) => {
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
 * Calls `POST {serviceUrl}/invoke` directly on the service dispatcher,
 * mirroring how `/inspect` works. The service URL is resolved from
 * `data.url` (stored) or built from `data.uri` via `buildServiceUrlFromUri`.
 *
 * Unified for all workflow types (apps and evaluators).
 */
export const invocationUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        // Resolve service URL: prefer stored url, fall back to building from URI
        const serviceUrl =
            entity.data.url?.replace(/\/+$/, "") ?? buildServiceUrlFromUri(entity.data.uri)

        if (serviceUrl) {
            return `${serviceUrl}/invoke`
        }

        return null
    }),
)

/**
 * Deployment URL for code snippets and external API usage.
 *
 * Unlike `invocationUrlAtomFamily` (used for playground execution via the
 * unified invoke endpoint), this returns the user-facing service URL with
 * `/v0/invoke` suffix that resolves config from deployed environments.
 *
 * Used by the deployment dashboard to generate code snippets.
 */
export const deploymentUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const resolvedBuiltinUrl = resolveBuiltinAppServiceUrl(entity)
        const effectiveAppUrl = resolvedBuiltinUrl ?? entity.data.url
        if (!effectiveAppUrl) return null

        const routePath = get(appRoutePathAtomFamily(workflowId))
        const parsed = parseRevisionUri(effectiveAppUrl)
        if (!parsed) return `${effectiveAppUrl}/v0/invoke`

        const apiUrl = getAgentaApiUrl()
        const currentOrigin = apiUrl ? apiUrl.replace(/\/api\/?$/, "") : null
        const storedOrigin = parsed.runtimePrefix.replace(/\/$/, "")
        const prefix =
            currentOrigin && currentOrigin !== storedOrigin ? currentOrigin : storedOrigin
        const cleanRoutePath = (routePath || parsed.routePath || "")
            .replace(/^\//, "")
            .replace(/\/$/, "")

        if (cleanRoutePath) {
            return `${prefix}/${cleanRoutePath}/v0/invoke`
        }
        return `${prefix}/v0/invoke`
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
        return resolveInputSchema(entity?.data) ?? null
    }),
)

/**
 * Output schema for the workflow.
 * Derived from `data.schemas.outputs`.
 */
export const outputSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        return resolveOutputSchema(entity?.data) ?? null
    }),
)

/**
 * Parameters schema for the workflow.
 *
 * Reads `entity.data.schemas.parameters`. For evaluator entities this is
 * already the nested UI shape (`{prompt, feedback_config, advanced_config}`)
 * because `workflowBaseEntityAtomFamily` runs `nestEvaluatorSchema` when the
 * entity is an evaluator — including ephemerals, where it first seeds the
 * flat schema from the builtin template catalog. `nestEvaluatorSchema` is
 * applied here too as a safety net since it's idempotent.
 */
export const parametersSchemaAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity) return null

        const isEvaluator = entity.flags?.is_evaluator === true
        let schema = resolveParametersSchema(entity.data) ?? null

        if (schema && isEvaluator) {
            schema = nestEvaluatorSchema(schema)
        }

        return schema
    }),
)

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Workflow configuration (parameters).
 */
export const configurationAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
        return resolveParameters(entity?.data) ?? null
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
        const entity = get(workflowBaseEntityAtomFamily(workflowId))
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
 *   (`__rawBody: true`) for `{serviceUrl}/invoke`.
 * - **App workflows** use `__rawBody` with `__appWorkflow` marker.
 *   The execution pipeline builds inputs via `buildRequestBody()` then
 *   wraps them into the invoke format. Metadata needed for `buildRequestBody()`
 *   is passed in `__meta`.
 * - **Ephemeral (base) workflows** return `RequestPayloadData` for trace replay.
 */
export const requestPayloadAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | RequestPayloadData | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const isEvaluator = entity.flags?.is_evaluator ?? false
        const isBase = entity.flags?.is_base ?? false

        // ── Ephemeral evaluator workflows: route via the evaluator URI ──
        // A base workflow that also carries is_evaluator came from a trace span
        // of an evaluator run. Treat it like a regular evaluator invocation
        // (__rawBody with interface.uri + data.parameters). The execution layer
        // populates data.inputs / data.outputs from the active testcase row.
        if (isBase && isEvaluator) {
            const uri = entity.data.uri
            if (!uri) return null

            const rawParams = (resolveParameters(entity.data) ?? {}) as Record<string, unknown>
            const flatSource = getFlatSourceData(get, workflowId)
            const flatParams =
                (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
            const parameters = flattenEvaluatorConfiguration(rawParams, flatParams)

            // Seed envelope inputs/outputs from meta so runs without a testcase
            // row still replay the original trace data. The execution layer
            // overrides these when an upstream inputValues is available.
            const meta = entity.meta as Record<string, unknown> | null | undefined
            const envelope = (meta?.envelope as Record<string, unknown> | undefined) ?? {}
            const envelopeInputs = (envelope.inputs as Record<string, unknown> | undefined) ?? {}
            const envelopeOutputs = envelope.outputs ?? {}

            return {
                __rawBody: true,
                interface: {uri},
                data: {
                    inputs: envelopeInputs,
                    outputs: envelopeOutputs,
                    parameters,
                    ...(envelope.trace ? {trace: envelope.trace} : {}),
                },
            }
        }

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

            const rawParams = (resolveParameters(entity.data) ?? {}) as Record<string, unknown>
            const flatSource = getFlatSourceData(get, workflowId)
            const flatParams =
                (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
            const parameters = flattenEvaluatorConfiguration(rawParams, flatParams)

            // Only include interface when invoking by URI (not when using data.url directly)
            const iface = uri && !url ? {uri} : undefined

            // Build trace-attribution references. Mirrors the app-workflow branch
            // below so a standalone evaluator run (depth-0 in the playground)
            // produces traces that the Observability page can filter by
            // "Application ID" — the workflow's artifact id is what the filter
            // matches against (`references.application.id`). Without this the
            // trace lands with `references: undefined` and the user sees an
            // empty Observability page for their evaluator.
            const evaluatorWorkflowId = entity.workflow_id ?? null
            const isLocal = isLocalDraftId(workflowId)
            const isDirty = get(workflowIsDirtyAtomFamily(workflowId))
            const references: Record<string, Record<string, string | undefined>> = {}
            if (evaluatorWorkflowId) {
                references.application = {id: evaluatorWorkflowId}
            }
            if (isLocal) {
                const localData = get(workflowLocalServerDataAtomFamily(workflowId)) as
                    | (Record<string, unknown> & {_sourceRevisionId?: string})
                    | null
                const sourceRevisionId = localData?._sourceRevisionId
                const variantId = entity.workflow_variant_id ?? entity.variant_id ?? null
                if (variantId) {
                    references.application_variant = {id: variantId}
                }
                if (sourceRevisionId) {
                    references.application_revision = {id: sourceRevisionId}
                }
            } else if (!isDirty) {
                const variantId = entity.workflow_variant_id ?? entity.variant_id ?? null
                if (variantId) {
                    references.application_variant = {id: variantId}
                }
                if (entity.id) {
                    references.application_revision = {id: entity.id}
                }
            }

            return {
                __rawBody: true,
                ...(iface ? {interface: iface} : {}),
                data: {
                    inputs: {},
                    outputs: {},
                    parameters,
                },
                references: Object.keys(references).length > 0 ? references : undefined,
            }
        }

        // ── App workflows: __rawBody format for {serviceUrl}/invoke ──
        const isChat = entity.flags?.is_chat ?? false
        const openApiSchema = get(appOpenApiSchemaAtomFamily(workflowId))
        const routePath = get(appRoutePathAtomFamily(workflowId))

        const resolvedUrl = resolveBuiltinAppServiceUrl(entity)
        const effectiveUrl = resolvedUrl ?? entity.data.url
        const parsed = effectiveUrl ? parseRevisionUri(effectiveUrl) : null

        // Extract ag_config from parameters
        const params = entity.data.parameters as Record<string, unknown> | undefined
        const agConfig = (params?.ag_config as Record<string, unknown>) || params || {}

        // Derive input variables: schema keys → prompt-template vars → persisted input_keys
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
        // For local drafts: always include variant/revision refs from the source
        // revision, since the server needs them to route the invocation.
        // For server-backed revisions: only include refs when clean (no uncommitted
        // draft changes), since dirty params don't match the committed revision.
        const appId = entity.workflow_id ?? null
        const isLocal = isLocalDraftId(workflowId)
        const isDirty = get(workflowIsDirtyAtomFamily(workflowId))
        const references: Record<string, Record<string, string | undefined>> = {}
        if (appId) {
            references.application = {id: appId}
        }
        if (isLocal) {
            // Local draft: use the source revision's variant/revision IDs
            const localData = get(workflowLocalServerDataAtomFamily(workflowId)) as
                | (Record<string, unknown> & {_sourceRevisionId?: string})
                | null
            const sourceRevisionId = localData?._sourceRevisionId
            const variantId = entity.workflow_variant_id ?? entity.variant_id ?? null
            if (variantId) {
                references.application_variant = {id: variantId}
            }
            if (sourceRevisionId) {
                references.application_revision = {id: sourceRevisionId}
            }
        } else if (!isDirty) {
            const variantId = entity.workflow_variant_id ?? entity.variant_id ?? null
            if (variantId) {
                references.application_variant = {id: variantId}
            }
            if (entity.id) {
                references.application_revision = {id: entity.id}
            }
        }

        // Only include interface when invoking by URI (not when using data.url directly,
        // since the URL is already encoded in the invocation endpoint).
        const uri = entity.data.uri
        const url = entity.data.url
        const iface = uri && !url ? {uri} : undefined

        // Parameters go under data (not configuration).
        // data.inputs will be populated at execution time by buildExecutionItem.
        return {
            __rawBody: true,
            __appWorkflow: true, // Marker for buildExecutionItem to apply app-specific transforms
            ...(iface ? {interface: iface} : {}),
            data: {
                inputs: {},
                parameters: agConfig && Object.keys(agConfig).length > 0 ? agConfig : undefined,
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
