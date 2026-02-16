/**
 * Evaluator Runnable Extension
 *
 * Provides runnable extension atoms for evaluator entities.
 * These atoms extend the evaluator molecule with runnable-specific functionality
 * so evaluators can be used in the playground package.
 *
 * ## Runnable Interface Contract
 *
 * The playground package expects runnables to provide:
 * - **invocationUrl**: URL to invoke the evaluator
 * - **inputPorts**: Input port definitions (from schemas.inputs)
 * - **outputPorts**: Output port definitions (from schemas.outputs)
 * - **configuration**: Evaluator parameters
 * - **executionMode**: Always "completion" for evaluators
 *
 * ## Evaluator Invocation
 *
 * Evaluators can be invoked via:
 * - Legacy: `POST /evaluators/{key}/run/` (uses evaluator key)
 * - Native: `POST /preview/workflows/invoke` (uses URI from data.uri)
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl} from "@agenta/shared/api"
import {atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {atomFamily} from "jotai-family"

import type {StoreOptions} from "../../shared"
import {parseEvaluatorKeyFromUri} from "../core/schema"

import {evaluatorEntityAtomFamily} from "./store"

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
 * Execution mode for evaluators.
 * Evaluators always run in "completion" mode (single input → output).
 */
export const executionModeAtomFamily = atomFamily((_evaluatorId: string) =>
    atom<"chat" | "completion">("completion"),
)

// ============================================================================
// INVOCATION URL
// ============================================================================

/**
 * Invocation URL for evaluator execution.
 *
 * For built-in evaluators, this constructs the legacy run endpoint:
 *   `POST /evaluators/{key}/run/`
 *
 * For custom evaluators with a webhook URL, uses `data.url`.
 *
 * For native workflow invoke, the playground should use `data.uri`
 * with the `/preview/workflows/invoke` endpoint instead.
 */
export const invocationUrlAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        if (!entity?.data) return null

        // Custom evaluators with webhook URL
        if (entity.data.url) {
            return entity.data.url
        }

        // Built-in evaluators use the legacy /evaluators/{key}/run endpoint.
        // Build an absolute URL using the API base to avoid mismatches
        // between Next.js proxy paths and direct backend paths.
        if (entity.data.uri) {
            const key = parseEvaluatorKeyFromUri(entity.data.uri)
            if (key) {
                return `${getAgentaApiUrl()}/evaluators/${key}/run`
            }
        }

        return null
    }),
)

// ============================================================================
// SCHEMA SELECTORS
// ============================================================================

/**
 * Input schema for the evaluator.
 * Derived from `data.schemas.inputs`.
 */
export const inputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return (entity?.data?.schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema for the evaluator.
 * Derived from `data.schemas.outputs`.
 */
export const outputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return (entity?.data?.schemas?.outputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Parameters schema for the evaluator.
 * Derived from `data.schemas.parameters`.
 */
export const parametersSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return (entity?.data?.schemas?.parameters as Record<string, unknown> | null) ?? null
    }),
)

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Evaluator configuration (parameters).
 * This is the equivalent of legacy `settings_values`.
 */
export const configurationAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.parameters ?? null
    }),
)

// ============================================================================
// URI
// ============================================================================

/**
 * Evaluator URI for native workflow invocation.
 * Example: "agenta:builtin:auto_exact_match:v0"
 */
export const evaluatorUriAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.uri ?? null
    }),
)

// ============================================================================
// REQUEST PAYLOAD
// ============================================================================

/**
 * Request payload for evaluator execution via the legacy /evaluators/{key}/run endpoint.
 *
 * Builds a `{inputs, settings}` body matching the DebugSection pattern.
 * The `__rawBody` flag signals the execution pipeline to use this payload
 * as the request body directly (instead of building a legacy ag_config body).
 *
 * The `inputs` field will be populated at execution time by the execution
 * item builder from the testcase row and prior chain step results.
 */
export const requestPayloadAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(evaluatorEntityAtomFamily(evaluatorId))
        if (!entity?.data) return null

        const uri = entity.data.uri
        if (!uri) return null

        return {
            __rawBody: true,
            inputs: {},
            settings: entity.data.parameters ?? entity.data.configuration ?? {},
        }
    }),
)

// ============================================================================
// RUNNABLE EXTENSION EXPORTS
// ============================================================================

/**
 * Runnable atoms collection for evaluator entities.
 */
export const runnableAtoms = {
    executionMode: executionModeAtomFamily,
    invocationUrl: invocationUrlAtomFamily,
    inputSchema: inputSchemaAtomFamily,
    outputSchema: outputSchemaAtomFamily,
    parametersSchema: parametersSchemaAtomFamily,
    configuration: configurationAtomFamily,
    uri: evaluatorUriAtomFamily,
    requestPayload: requestPayloadAtomFamily,
}

/**
 * Runnable imperative get API.
 */
export const runnableGet = {
    executionMode: (evaluatorId: string, options?: StoreOptions) =>
        getStore(options).get(executionModeAtomFamily(evaluatorId)),
    invocationUrl: (evaluatorId: string, options?: StoreOptions) =>
        getStore(options).get(invocationUrlAtomFamily(evaluatorId)),
    configuration: (evaluatorId: string, options?: StoreOptions) =>
        getStore(options).get(configurationAtomFamily(evaluatorId)),
    uri: (evaluatorId: string, options?: StoreOptions) =>
        getStore(options).get(evaluatorUriAtomFamily(evaluatorId)),
}

/**
 * Evaluator runnable extension — provides all runnable-related atoms
 * for integration with the playground bridge.
 */
export const evaluatorRunnableExtension = {
    atoms: runnableAtoms,
    get: runnableGet,
}
