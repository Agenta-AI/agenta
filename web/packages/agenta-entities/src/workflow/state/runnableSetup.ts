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

import type {RequestPayloadData} from "../../runnable/types"
import type {StoreOptions} from "../../shared"
import {parseRevisionUri} from "../../shared"

import {workflowAppSchemaAtomFamily, workflowEntityAtomFamily} from "./store"

// ============================================================================
// HELPERS
// ============================================================================

function getStore(options?: StoreOptions) {
    return options?.store ?? getDefaultStore()
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
 * Route path derived from the app schema query.
 * Only populated for non-evaluator app workflows with a `data.url`.
 */
export const appRoutePathAtomFamily = atomFamily((workflowId: string) =>
    atom<string>((get) => {
        const appSchemaQuery = get(workflowAppSchemaAtomFamily(workflowId))
        return appSchemaQuery.data?.routePath || ""
    }),
)

/**
 * Raw dereferenced OpenAPI spec from the app schema query.
 * Needed by `buildRequestBody()` for input mapping and custom workflow detection.
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
 * Resolution order:
 * - **App workflows** (non-evaluator with `data.url`): `{runtimePrefix}/{routePath}/test`
 * - **Evaluator workflows** with `data.url`: URL as-is
 * - **URI-based workflows**: `/preview/workflows/invoke`
 */
export const invocationUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const isEvaluator = entity.flags?.is_evaluator ?? false

        // App workflows with URL: build invocation URL from runtimePrefix + routePath
        if (entity.data.url && !isEvaluator) {
            const routePath = get(appRoutePathAtomFamily(workflowId))
            const parsed = parseRevisionUri(entity.data.url)
            if (!parsed) return `${entity.data.url}/test`

            const prefix = parsed.runtimePrefix.replace(/\/$/, "")
            const cleanRoutePath = (routePath || parsed.routePath || "")
                .replace(/^\//, "")
                .replace(/\/$/, "")

            if (cleanRoutePath) {
                return `${prefix}/${cleanRoutePath}/test`
            }
            return `${prefix}/test`
        }

        // Evaluator workflows with URL: return URL as-is
        if (entity.data.url && isEvaluator) {
            return entity.data.url
        }

        // URI-based invocation (evaluators and workflows without URL)
        if (entity.data.uri) {
            return `${getAgentaApiUrl()}/preview/workflows/invoke`
        }

        return null
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
 * - **App workflows** return `RequestPayloadData` so the standard
 *   `buildRequestBody()` path constructs the `{ag_config, inputs}` format
 *   expected by their `/test` endpoints.
 */
export const requestPayloadAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | RequestPayloadData | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        const isEvaluator = entity.flags?.is_evaluator ?? false

        // ── Evaluator workflows: use __rawBody format ──
        if (isEvaluator) {
            const uri = entity.data.uri
            const url = entity.data.url
            if (!uri && !url) return null

            const parameters = entity.data.parameters ?? entity.data.configuration ?? {}
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

        // ── App workflows: return RequestPayloadData for buildRequestBody() ──
        const invocationUrl = get(invocationUrlAtomFamily(workflowId))
        const isChat = entity.flags?.is_chat ?? false
        const openApiSchema = get(appOpenApiSchemaAtomFamily(workflowId))
        const routePath = get(appRoutePathAtomFamily(workflowId))
        const parsed = entity.data.url ? parseRevisionUri(entity.data.url) : null

        // Extract ag_config from parameters
        const params = entity.data.parameters as Record<string, unknown> | undefined
        const agConfig = (params?.ag_config as Record<string, unknown>) || params || {}

        // Extract variables from ag_config prompt configs' input_keys
        const variables: string[] = []
        try {
            for (const val of Object.values(agConfig)) {
                const valRecord = val as Record<string, unknown> | null
                if (valRecord && typeof valRecord === "object" && "input_keys" in valRecord) {
                    const keys = valRecord.input_keys
                    if (Array.isArray(keys)) {
                        for (const k of keys) {
                            if (typeof k === "string" && !variables.includes(k)) {
                                variables.push(k)
                            }
                        }
                    }
                }
            }
        } catch {
            // best-effort
        }

        return {
            ag_config: agConfig,
            isChat,
            appType: null,
            invocationUrl,
            runtimePrefix: parsed?.runtimePrefix ?? null,
            variables,
            spec: openApiSchema,
            routePath: routePath || undefined,
        } satisfies RequestPayloadData
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
