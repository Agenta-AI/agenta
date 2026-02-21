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

import type {StoreOptions} from "../../shared"

import {workflowEntityAtomFamily} from "./store"

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
// INVOCATION URL
// ============================================================================

/**
 * Invocation URL for workflow execution.
 *
 * Resolution order:
 * 1. `data.url` → use directly (custom/webhook workflow)
 * 2. `data.uri` → native workflow invoke endpoint (`/preview/workflows/invoke`)
 * 3. null
 */
export const invocationUrlAtomFamily = atomFamily((workflowId: string) =>
    atom<string | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        // Custom workflows with webhook URL
        if (entity.data.url) {
            // Evaluator workflows return the URL as-is (no /test suffix)
            if (entity.flags?.is_evaluator) {
                return entity.data.url
            }
            return `${entity.data.url}/test`
        }

        // URI-based invocation — all workflows (including evaluators) use
        // the unified /preview/workflows/invoke endpoint.
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
 * Only **evaluator** workflows use the `{interface, configuration, data}`
 * format for the unified `/preview/workflows/invoke` endpoint.
 *
 * Non-evaluator workflows (regular apps) return `null` so the standard
 * `buildRequestBody()` path constructs the flat request body expected
 * by their custom `/test` endpoints.
 */
export const requestPayloadAtomFamily = atomFamily((workflowId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(workflowEntityAtomFamily(workflowId))
        if (!entity?.data) return null

        // Only evaluator workflows use the raw body format.
        // Regular app workflows fall through to buildRequestBody().
        const isEvaluator =
            entity.flags?.is_evaluator ||
            (entity.data.uri && entity.data.uri.startsWith("agenta:builtin:"))
        if (!isEvaluator) return null

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
