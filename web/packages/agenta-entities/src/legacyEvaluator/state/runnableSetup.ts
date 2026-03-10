/**
 * LegacyEvaluator Runnable Extension
 *
 * Provides runnable extension atoms for LegacyEvaluator entities.
 * These atoms extend the molecule with runnable-specific functionality
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

import {legacyEvaluatorEntityAtomFamily} from "./store"

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
 * Uses the native workflow invoke endpoint:
 *   `POST /preview/workflows/invoke`
 *
 * For custom evaluators with a webhook URL, `data.url` is passed
 * as `interface.url` in the request body (not as the invocation URL).
 *
 * The invocation URL always points to the workflow invoke endpoint.
 * The evaluator URI or webhook URL is embedded in the request payload.
 */
export const invocationUrlAtomFamily = atomFamily((evaluatorId: string) =>
    atom<string | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        if (!entity?.data) return null

        // All evaluators go through the workflow invoke endpoint.
        // The URI/URL is passed in the request body's `interface` field.
        // Build an absolute URL using the API base to avoid path mismatches.
        if (entity.data.uri || entity.data.url) {
            return `${getAgentaApiUrl()}/preview/workflows/invoke`
        }

        return null
    }),
)

// ============================================================================
// SCHEMA SELECTORS
// ============================================================================

/**
 * Input schema for the evaluator.
 */
export const inputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return (entity?.data?.schemas?.inputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Output schema for the evaluator.
 */
export const outputSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return (entity?.data?.schemas?.outputs as Record<string, unknown> | null) ?? null
    }),
)

/**
 * Parameters schema for the evaluator.
 */
export const parametersSchemaAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
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
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
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
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        return entity?.data?.uri ?? null
    }),
)

// ============================================================================
// REQUEST PAYLOAD
// ============================================================================

/**
 * Request payload for evaluator execution via the workflow invoke endpoint.
 *
 * Builds a `POST /preview/workflows/invoke` body:
 * ```json
 * {
 *   "interface": { "uri": "agenta:builtin:..." },  // or { "url": "https://..." }
 *   "configuration": { "parameters": { ... } },
 *   "data": { "inputs": {}, "outputs": {}, "parameters": {} }
 * }
 * ```
 *
 * The `__rawBody` flag signals the execution pipeline to use this
 * payload as the request body directly.
 */
export const requestPayloadAtomFamily = atomFamily((evaluatorId: string) =>
    atom<Record<string, unknown> | null>((get) => {
        const entity = get(legacyEvaluatorEntityAtomFamily(evaluatorId))
        if (!entity?.data) return null

        const uri = entity.data.uri
        const url = entity.data.url

        if (!uri && !url) return null

        const interfaceField: Record<string, unknown> = {}
        if (url) {
            interfaceField.url = url
        } else if (uri) {
            interfaceField.uri = uri
        }

        const parameters = entity.data.parameters ?? {}
        const references: Record<string, Record<string, string | undefined>> = {}
        if (entity.id || entity.slug) {
            references.evaluator = {
                id: entity.id || undefined,
                slug: entity.slug ?? undefined,
            }
        }

        return {
            __rawBody: true,
            interface: interfaceField,
            configuration: Object.keys(parameters).length > 0 ? {parameters} : undefined,
            references: Object.keys(references).length > 0 ? references : undefined,
            data: {
                inputs: {},
                outputs: {},
                // Mirror configuration.parameters into data.parameters
                // so the backend resolver sees them in both locations.
                parameters: Object.keys(parameters).length > 0 ? parameters : {},
            },
        }
    }),
)

// ============================================================================
// RUNNABLE EXTENSION EXPORTS
// ============================================================================

/**
 * Runnable atoms collection for LegacyEvaluator entities.
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
 * LegacyEvaluator runnable extension — provides all runnable-related atoms
 * for integration with the playground bridge.
 */
export const legacyEvaluatorRunnableExtension = {
    atoms: runnableAtoms,
    get: runnableGet,
}
