/**
 * Runnable Bridge Configuration
 *
 * Configures the runnable bridge with available runnable types.
 * This is where molecule integrations are defined.
 *
 * @example
 * ```typescript
 * import { runnableBridge } from '@agenta/entities/runnable'
 *
 * // Use unified API
 * const data = useAtomValue(runnableBridge.selectors.data(runnableId))
 * const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(runnableId))
 *
 * // Or access runnable-specific features
 * const evaluatorController = runnableBridge.runnable('evaluatorRevision')
 * const presets = useAtomValue(evaluatorController.selectors.presets(evaluatorId))
 * ```
 */

import {atom} from "jotai"

import {
    createRunnableBridge,
    type RunnableData,
    type RunnablePort,
} from "../shared"
import {appRevisionMolecule} from "../appRevision"
import {evaluatorRevisionMolecule} from "../evaluatorRevision"

import type {PathItem} from "./types"

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a key as a human-readable name
 */
function formatKeyAsName(key: string): string {
    return key
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/^./, (str) => str.toUpperCase())
}

/**
 * Extract input ports from a JSON schema
 */
function extractInputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>
    const properties = s.properties as Record<string, unknown> | undefined
    const required = (s.required as string[]) || []

    if (!properties) return []

    return Object.entries(properties).map(([key, prop]) => {
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            required: required.includes(key),
            schema: prop,
        }
    })
}

/**
 * Extract output ports from a JSON schema
 */
function extractOutputPortsFromSchema(schema: unknown): RunnablePort[] {
    if (!schema || typeof schema !== "object") return []

    const s = schema as Record<string, unknown>

    // Handle simple type schema
    if (s.type && s.type !== "object") {
        return [
            {
                key: "output",
                name: "Output",
                type: s.type as string,
                schema,
            },
        ]
    }

    // Handle object schema
    const properties = s.properties as Record<string, unknown> | undefined
    if (!properties) {
        return [
            {
                key: "output",
                name: "Output",
                type: "unknown",
                schema,
            },
        ]
    }

    return Object.entries(properties).map(([key, prop]) => {
        const p = prop as Record<string, unknown>
        return {
            key,
            name: (p.title as string) || formatKeyAsName(key),
            type: (p.type as string) || "string",
            schema: prop,
        }
    })
}

// ============================================================================
// APP REVISION CONFIGURATION
// ============================================================================

interface AppRevisionEntity {
    id: string
    name?: string
    variantSlug?: string
    version?: number
    configuration?: Record<string, unknown>
    invocationUrl?: string
    appId?: string
    variantId?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

function appRevisionToRunnable(entity: unknown): RunnableData {
    const e = entity as AppRevisionEntity
    return {
        id: e.id,
        name: e.name || e.variantSlug,
        version: e.version,
        slug: e.variantSlug,
        configuration: e.configuration,
        invocationUrl: e.invocationUrl,
        schemas: e.schemas,
    }
}

function getAppRevisionInputPorts(entity: unknown): RunnablePort[] {
    const e = entity as AppRevisionEntity
    return extractInputPortsFromSchema(e.schemas?.inputSchema)
}

function getAppRevisionOutputPorts(entity: unknown): RunnablePort[] {
    const e = entity as AppRevisionEntity
    return extractOutputPortsFromSchema(e.schemas?.outputSchema)
}

// ============================================================================
// EVALUATOR REVISION CONFIGURATION
// ============================================================================

interface EvaluatorRevisionEntity {
    id: string
    name?: string
    slug?: string
    version?: number
    configuration?: Record<string, unknown>
    invocationUrl?: string
    schemas?: {
        inputSchema?: unknown
        outputSchema?: unknown
    }
}

function evaluatorRevisionToRunnable(entity: unknown): RunnableData {
    const e = entity as EvaluatorRevisionEntity
    return {
        id: e.id,
        name: e.name || e.slug,
        version: e.version,
        slug: e.slug,
        configuration: e.configuration,
        invocationUrl: e.invocationUrl,
        schemas: e.schemas,
    }
}

function getEvaluatorRevisionInputPorts(entity: unknown): RunnablePort[] {
    const e = entity as EvaluatorRevisionEntity
    return extractInputPortsFromSchema(e.schemas?.inputSchema)
}

function getEvaluatorRevisionOutputPorts(entity: unknown): RunnablePort[] {
    const e = entity as EvaluatorRevisionEntity
    // Evaluators typically output a score
    const schemaOutputs = extractOutputPortsFromSchema(e.schemas?.outputSchema)
    if (schemaOutputs.length > 0) return schemaOutputs

    // Default evaluator output
    return [
        {
            key: "score",
            name: "Score",
            type: "number",
        },
    ]
}

// ============================================================================
// CONFIGURED BRIDGE
// ============================================================================

/**
 * Runnable bridge configured with available runnable types
 *
 * Currently supports:
 * - **appRevision**: App revision via appRevisionMolecule
 * - **evaluatorRevision**: Evaluator revision via evaluatorRevisionMolecule (stub in OSS)
 */
export const runnableBridge = createRunnableBridge({
    runnables: {
        appRevision: {
            molecule: appRevisionMolecule,
            toRunnable: appRevisionToRunnable,
            getInputPorts: getAppRevisionInputPorts,
            getOutputPorts: getAppRevisionOutputPorts,
        },
        evaluatorRevision: {
            molecule: evaluatorRevisionMolecule,
            toRunnable: evaluatorRevisionToRunnable,
            getInputPorts: getEvaluatorRevisionInputPorts,
            getOutputPorts: getEvaluatorRevisionOutputPorts,
            extraSelectors: {
                presets: (id: string) => evaluatorRevisionMolecule.selectors.presets(id),
            },
            extraActions: {
                applyPreset: evaluatorRevisionMolecule.actions.applyPreset,
            },
        },
    },
})

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {extractInputPortsFromSchema, extractOutputPortsFromSchema, formatKeyAsName}
