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
 * // Use flattened API (preferred)
 * const data = useAtomValue(runnableBridge.data(runnableId))
 * const inputPorts = useAtomValue(runnableBridge.inputPorts(runnableId))
 * const outputPorts = useAtomValue(runnableBridge.outputPorts(runnableId))
 * const config = useAtomValue(runnableBridge.config(runnableId))
 *
 * // Or access runnable-specific features
 * const evaluatorController = runnableBridge.runnable('evaluatorRevision')
 * const presets = useAtomValue(evaluatorController.selectors.presets(evaluatorId))
 * ```
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {appRevisionMolecule} from "../appRevision"
import {evaluatorRevisionMolecule} from "../evaluatorRevision"
import {loadableStateAtomFamily, loadableColumnsAtomFamily} from "../loadable/store"
import {createRunnableBridge, type RunnableData, type RunnablePort} from "../shared"

import type {PathItem, RunnableType, TestsetColumn} from "./types"

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
            // Use molecule selectors for reactive derivation (preferred over extraction functions)
            inputPortsSelector: (id: string) => appRevisionMolecule.selectors.inputPorts(id),
            outputPortsSelector: (id: string) => appRevisionMolecule.selectors.outputPorts(id),
            invocationUrlSelector: (id: string) => appRevisionMolecule.atoms.invocationUrl(id),
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
// LOADABLE-RUNNABLE INTEGRATION
// ============================================================================

/**
 * Derived columns atom that reads from the linked runnable's inputPorts.
 *
 * When a loadable is linked to a runnable, this atom:
 * 1. Gets the linked runnable info from loadable state
 * 2. Reads the runnable's inputPorts (single source of truth)
 * 3. Returns columns derived from inputPorts
 *
 * This enables reactive updates - when user edits {{newVar}} in prompt,
 * the columns automatically update without any React effects.
 *
 * For appRevision: Uses appRevisionMolecule.selectors.inputPorts (consolidated)
 * For evaluatorRevision: Reads from evaluator schema directly
 */
export const loadableColumnsFromRunnableAtomFamily = atomFamily((loadableId: string) =>
    atom<TestsetColumn[]>((get) => {
        const loadableState = get(loadableStateAtomFamily(loadableId))
        const {linkedRunnableType, linkedRunnableId} = loadableState

        // If not linked to a runnable, return stored columns
        if (!linkedRunnableType || !linkedRunnableId) {
            return get(loadableColumnsAtomFamily(loadableId))
        }

        // Get columns from linked runnable's inputPorts
        if (linkedRunnableType === "appRevision") {
            // Use inputPorts selector - single source of truth for revision inputs
            // This selector already handles extraction from agConfig prompt messages
            const inputPorts = get(appRevisionMolecule.selectors.inputPorts(linkedRunnableId))

            if (inputPorts.length > 0) {
                return inputPorts.map((port) => ({
                    key: port.key,
                    name: port.name,
                    type: port.type,
                }))
            }
        } else if (linkedRunnableType === "evaluatorRevision") {
            // Read from evaluator entity's schema
            const entityData = get(
                evaluatorRevisionMolecule.selectors.data(linkedRunnableId),
            ) as Record<string, unknown> | null
            if (entityData) {
                const schemas = entityData.schemas as Record<string, unknown> | undefined
                const inputSchema = schemas?.inputs as Record<string, unknown> | undefined
                if (inputSchema?.properties) {
                    const inputKeys = Object.keys(inputSchema.properties as Record<string, unknown>)
                    if (inputKeys.length > 0) {
                        return inputKeys.map((key) => ({
                            key,
                            name: key,
                            type: "string" as const,
                        }))
                    }
                }
            }
        }

        // Fall back to stored columns if no inputPorts found
        return get(loadableColumnsAtomFamily(loadableId))
    }),
)

// ============================================================================
// DRILL-IN NAVIGATION
// ============================================================================

/** Data type for getRunnableRootItems */
interface RunnableDataForRootItems {
    configuration?: Record<string, unknown>
}

/**
 * Get root items for DrillIn navigation based on runnable type
 *
 * Generates PathItems from the runnable's configuration for use in
 * DrillIn navigation UI components (ConfigurationSection).
 */
export function getRunnableRootItems(
    _type: RunnableType,
    data: RunnableDataForRootItems | null,
): PathItem[] {
    if (!data) return []

    const items: PathItem[] = []
    const configuration = data.configuration

    if (configuration) {
        // Generate items from configuration keys
        for (const [key, value] of Object.entries(configuration)) {
            // Skip internal fields
            if (key === "version" || key.startsWith("_")) continue

            items.push({
                key,
                name: formatKeyAsName(key),
                value,
            })
        }
    }

    return items
}

// ============================================================================
// UTILITY EXPORTS
// ============================================================================

export {extractInputPortsFromSchema, extractOutputPortsFromSchema, formatKeyAsName}
