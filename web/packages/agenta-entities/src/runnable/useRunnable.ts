/**
 * useRunnable Hook and Runnable Selectors (Optional Convenience Wrappers)
 *
 * These hooks are OPTIONAL convenience wrappers around `runnableBridge`.
 * For better architecture, prefer using `runnableBridge` directly with atoms.
 *
 * ## Recommended: Use runnableBridge directly
 *
 * ```typescript
 * import { runnableBridge } from '@agenta/entities/runnable'
 * import { useAtomValue } from 'jotai'
 *
 * // Read state via derived atoms (no side effects)
 * const data = useAtomValue(runnableBridge.selectors.data(runnableId))
 * const inputPorts = useAtomValue(runnableBridge.selectors.inputPorts(runnableId))
 *
 * // Access evaluator-specific features
 * const evalController = runnableBridge.runnable('evaluatorRevision')
 * const presets = useAtomValue(evalController.selectors.presets(evaluatorId))
 * ```
 *
 * ## Legacy: useRunnable hook
 *
 * ```typescript
 * import { useRunnable } from '@agenta/entities/runnable'
 *
 * const { data, isLoading, execute } = useRunnable('appRevision', revisionId)
 * ```
 *
 * @deprecated Prefer `runnableBridge` for a more predictable, side-effect-free API
 */

import {useCallback, useMemo, useState} from "react"

import {atom, useAtomValue, useSetAtom, type Atom} from "jotai"

import {appRevisionMolecule} from "../appRevision"
import {evaluatorRevisionMolecule} from "../evaluatorRevision"

import type {PlaygroundEntityProviders, SettingsPreset} from "./providerTypes"
import type {
    RunnableType,
    RunnableData,
    RunnableInputPort,
    RunnableOutputPort,
    ExecutionResult,
    AppRevisionData,
    PathItem,
} from "./types"
import {executeRunnable, extractVariablesFromAgConfig, extractVariablesFromPrompts} from "./utils"

// ============================================================================
// DEFAULT PROVIDERS (using package molecules directly)
// ============================================================================

/**
 * Default providers using the package's entity molecules.
 * This eliminates the need for context injection since both OSS and EE
 * use the same package implementations.
 *
 * Note: Type assertions are used because the molecule types are slightly different
 * from the PlaygroundEntityProviders interface types, but they are compatible at runtime.
 */
const defaultProviders = {
    appRevision: {
        selectors: {
            data: appRevisionMolecule.selectors.data,
            query: appRevisionMolecule.selectors.query,
            isDirty: appRevisionMolecule.selectors.isDirty,
            // Schema selectors for deriving input/output ports
            inputsSchema: appRevisionMolecule.selectors.inputsSchema,
        },
    },
    evaluatorRevision: {
        selectors: {
            data: evaluatorRevisionMolecule.selectors.data,
            query: evaluatorRevisionMolecule.selectors.query,
            isDirty: evaluatorRevisionMolecule.selectors.isDirty,
            presets: evaluatorRevisionMolecule.selectors.presets,
        },
        actions: {
            applyPreset: evaluatorRevisionMolecule.actions.applyPreset,
        },
    },
} as unknown as PlaygroundEntityProviders

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Format a key as a human-readable name
 */
function formatKeyAsName(key: string): string {
    const withSpaces = key.replace(/_/g, " ")
    const withCamelSpaces = withSpaces.replace(/([a-z])([A-Z])/g, "$1 $2")
    return withCamelSpaces
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

/**
 * Get root items for DrillIn navigation based on runnable type
 */
export function getRunnableRootItems(_type: RunnableType, data: RunnableData | null): PathItem[] {
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
// RUNNABLE SELECTORS FACTORY
// ============================================================================

/**
 * Create runnable selectors with injected entity providers
 * This is the core factory that creates selectors using the provided entity modules.
 */
export function createRunnableSelectors(providers: PlaygroundEntityProviders) {
    return {
        /**
         * Get runnable data by type and ID
         * Returns a unified RunnableData structure
         */
        data: (type: RunnableType, id: string) => {
            if (type === "appRevision") {
                return atom((get) => {
                    const revisionDataAtom = providers.appRevision.selectors.data(id)
                    const revisionData = get(revisionDataAtom)

                    if (!revisionData) return null

                    // Extract input ports - prioritize dynamic extraction from prompt content
                    // This allows the UI to react to template variable changes in real-time
                    const inputPorts: RunnableInputPort[] = []
                    let inputSchema: Record<string, unknown> | undefined = undefined

                    // Get agConfig for dynamic extraction and static input_keys
                    // Type assertion needed: revisionData structure varies by provider
                    const agConfig = (revisionData as {agConfig?: Record<string, unknown>}).agConfig
                    const promptConfig = agConfig?.prompt as Record<string, unknown> | undefined

                    // PRIORITY 1: Dynamically extract variables from prompt messages
                    // This reacts to edits - when user adds {{test}}, it immediately appears
                    const dynamicInputKeys = extractVariablesFromAgConfig(agConfig)

                    // PRIORITY 2: Static input_keys from config (original saved values)
                    const configInputKeys = (promptConfig?.input_keys ||
                        promptConfig?.inputKeys) as string[] | undefined

                    // PRIORITY 3: Check prompts array for inputKeys (transformed format)
                    // Type assertion needed: revisionData structure varies by provider
                    const prompts = (
                        revisionData as {prompts?: {messages?: unknown; inputKeys?: string[]}[]}
                    ).prompts
                    const promptsInputKeys = prompts?.[0]?.inputKeys

                    // PRIORITY 4: Extract from prompts array messages if agConfig doesn't have messages
                    const promptsMessageVars = prompts ? extractVariablesFromPrompts(prompts) : []

                    // Use dynamic extraction first (reacts to edits), then static, then prompts array
                    const inputKeys =
                        dynamicInputKeys.length > 0
                            ? dynamicInputKeys
                            : promptsMessageVars.length > 0
                              ? promptsMessageVars
                              : configInputKeys || promptsInputKeys

                    if (inputKeys && inputKeys.length > 0) {
                        // Create input ports from extracted input_keys
                        for (const key of inputKeys) {
                            inputPorts.push({
                                key,
                                name: key,
                                type: "string",
                                required: true,
                            })
                        }
                        // Build inputSchema from input_keys for compatibility
                        inputSchema = {
                            type: "object",
                            properties: Object.fromEntries(
                                inputKeys.map((key) => [key, {type: "string"}]),
                            ),
                            required: inputKeys,
                        }
                    } else {
                        // Fall back to OpenAPI schema if no input_keys in config
                        // Type assertion needed: provider selectors are dynamically typed
                        type InputsSchemaSelector = (params: {
                            revisionId: string
                            endpoint: string
                        }) => unknown
                        const inputsSchemaSelector = (
                            providers.appRevision.selectors as {inputsSchema?: InputsSchemaSelector}
                        ).inputsSchema

                        // Note: molecule's selector expects { revisionId, endpoint }
                        const inputsSchemaAtom = inputsSchemaSelector?.({
                            revisionId: id,
                            endpoint: "/test",
                        })

                        const schemaResult = inputsSchemaAtom
                            ? (get(
                                  inputsSchemaAtom as Atom<{
                                      properties?: Record<
                                          string,
                                          {type?: string; description?: string}
                                      >
                                      required?: string[]
                                  } | null>,
                              ) as {
                                  properties?: Record<string, {type?: string; description?: string}>
                                  required?: string[]
                              } | null)
                            : null

                        if (schemaResult?.properties) {
                            inputSchema = schemaResult as Record<string, unknown>
                            const props = schemaResult.properties
                            const required = schemaResult.required || []
                            for (const [key, prop] of Object.entries(props)) {
                                inputPorts.push({
                                    key,
                                    name: key,
                                    type: prop.type || "string",
                                    required: required.includes(key),
                                    description: prop.description,
                                })
                            }
                        }
                    }

                    // Extract output ports from outputSchema
                    const outputPorts: RunnableOutputPort[] = []
                    const outputSchema = revisionData.schemas?.outputs as
                        | Record<string, unknown>
                        | undefined
                    if (outputSchema?.properties) {
                        const props = outputSchema.properties as Record<
                            string,
                            {type?: string; description?: string}
                        >
                        for (const [key, prop] of Object.entries(props)) {
                            outputPorts.push({
                                key,
                                name: key,
                                type: prop.type || "string",
                                description: prop.description,
                            })
                        }
                    } else {
                        // Default output port
                        outputPorts.push({
                            key: "output",
                            name: "Output",
                            type: "string",
                        })
                    }

                    // The molecule returns AppRevisionData which has agConfig, not configuration
                    // Cast to access the actual field names
                    const actualData = revisionData as unknown as {
                        agConfig?: Record<string, unknown>
                        prompts?: unknown[]
                        parameters?: Record<string, unknown>
                    }

                    // Use agConfig if available, otherwise fall back to configuration
                    const configuration =
                        actualData.agConfig || revisionData.configuration || undefined

                    // Get invocation URL from molecule's runnable atoms (computed from schema query)
                    const invocationUrlAtom = appRevisionMolecule.atoms.invocationUrl(id)
                    const invocationUrl = get(invocationUrlAtom)

                    const runnableData: AppRevisionData = {
                        id,
                        type: "appRevision",
                        name: revisionData.name || revisionData.variantSlug,
                        label: revisionData.variantSlug
                            ? `${revisionData.variantSlug} v${revisionData.version || 1}`
                            : `Revision ${id.slice(0, 8)}`,
                        inputSchema: inputSchema as Record<string, unknown> | undefined,
                        outputSchema: outputSchema,
                        inputPorts,
                        outputPorts,
                        configuration,
                        invocationUrl: invocationUrl ?? undefined,
                        appId: revisionData.appId,
                        variantId: revisionData.variantId,
                        variantSlug: revisionData.variantSlug,
                        version: revisionData.version,
                        revision: revisionData.version,
                    }

                    return runnableData
                })
            } else if (type === "evaluatorRevision") {
                return atom((get) => {
                    const revisionDataAtom = providers.evaluatorRevision.selectors.data(id)
                    const revisionData = get(revisionDataAtom)

                    if (!revisionData) return null

                    // Extract input ports from schemas.inputs
                    const inputPorts: RunnableInputPort[] = []
                    const inputSchema = revisionData.schemas?.inputs as
                        | Record<string, unknown>
                        | undefined
                    if (inputSchema?.properties) {
                        const props = inputSchema.properties as Record<
                            string,
                            {type?: string; description?: string}
                        >
                        const required = (inputSchema.required as string[]) || []
                        for (const [key, prop] of Object.entries(props)) {
                            inputPorts.push({
                                key,
                                name: key,
                                type: prop.type || "string",
                                required: required.includes(key),
                                description: prop.description,
                            })
                        }
                    }

                    // Extract output ports from schemas.outputs
                    const outputPorts: RunnableOutputPort[] = []
                    const outputSchema = revisionData.schemas?.outputs as
                        | Record<string, unknown>
                        | undefined
                    if (outputSchema?.properties) {
                        const props = outputSchema.properties as Record<
                            string,
                            {type?: string; description?: string}
                        >
                        for (const [key, prop] of Object.entries(props)) {
                            outputPorts.push({
                                key,
                                name: key,
                                type: prop.type || "string",
                                description: prop.description,
                            })
                        }
                    } else {
                        // Default output port for evaluators
                        outputPorts.push({
                            key: "score",
                            name: "Score",
                            type: "number",
                        })
                    }

                    const runnableData: RunnableData = {
                        id,
                        type: "evaluatorRevision",
                        name: revisionData.name,
                        label: revisionData.slug
                            ? `${revisionData.slug} v${revisionData.version || 1}`
                            : `Evaluator ${id.slice(0, 8)}`,
                        inputSchema: inputSchema,
                        outputSchema: outputSchema,
                        inputPorts,
                        outputPorts,
                        configuration: revisionData.configuration,
                        invocationUrl: revisionData.invocationUrl,
                    }

                    return runnableData
                })
            }

            // Unknown type - return null atom
            return atom<RunnableData | null>(null)
        },

        /**
         * Get input ports for a runnable
         */
        inputPorts: (type: RunnableType, id: string) => {
            const selectors = createRunnableSelectors(providers)
            return atom((get) => {
                const dataAtom = selectors.data(type, id)
                const data = get(dataAtom)
                return data?.inputPorts || []
            })
        },

        /**
         * Get output ports for a runnable
         */
        outputPorts: (type: RunnableType, id: string) => {
            const selectors = createRunnableSelectors(providers)
            return atom((get) => {
                const dataAtom = selectors.data(type, id)
                const data = get(dataAtom)
                return data?.outputPorts || []
            })
        },

        /**
         * Check if runnable is loading
         */
        isLoading: (type: RunnableType, id: string) => {
            if (type === "appRevision") {
                return atom((get) => {
                    const queryAtom = providers.appRevision.selectors.query(id)
                    const query = get(queryAtom)
                    return query.isPending
                })
            } else if (type === "evaluatorRevision") {
                return atom((get) => {
                    const queryAtom = providers.evaluatorRevision.selectors.query(id)
                    const query = get(queryAtom)
                    return query.isPending
                })
            }
            return atom(false)
        },

        /**
         * Get available presets for a runnable
         * Only evaluator revisions have presets
         */
        presets: (type: RunnableType, id: string) => {
            if (type === "evaluatorRevision") {
                return providers.evaluatorRevision.selectors.presets(id)
            }
            // App revisions don't have presets
            return atom<SettingsPreset[]>([])
        },
    }
}

/**
 * Create runnable actions with injected entity providers
 */
export function createRunnableActions(providers: PlaygroundEntityProviders) {
    return {
        /**
         * Apply a preset's settings values to the configuration
         * Only works for evaluator revisions
         */
        applyPreset: providers.evaluatorRevision.actions.applyPreset,
    }
}

// ============================================================================
// REACT HOOKS
// ============================================================================

/**
 * Hook to get runnable selectors
 *
 * @example
 * ```tsx
 * const runnableSelectors = useRunnableSelectors()
 * const dataAtom = runnableSelectors.data('appRevision', revisionId)
 * const data = useAtomValue(dataAtom)
 * ```
 */
export function useRunnableSelectors() {
    return useMemo(() => createRunnableSelectors(defaultProviders), [])
}

/**
 * Hook to get runnable actions
 */
export function useRunnableActions() {
    return useMemo(() => createRunnableActions(defaultProviders), [])
}

/**
 * Hook for working with a runnable entity
 *
 * @param type - The runnable type
 * @param id - The runnable ID
 * @returns Object with data, loading state, and execute function
 */
export function useRunnable(type: RunnableType | undefined, id: string) {
    const runnableSelectors = useMemo(() => createRunnableSelectors(defaultProviders), [])

    // Get data atom
    const dataAtom = useMemo(() => {
        if (!type || !id) return atom<RunnableData | null>(null)
        return runnableSelectors.data(type, id)
    }, [type, id, runnableSelectors])

    // Get loading atom
    const loadingAtom = useMemo(() => {
        if (!type || !id) return atom(false)
        return runnableSelectors.isLoading(type, id)
    }, [type, id, runnableSelectors])

    // Get error atom
    const errorAtom = useMemo(() => {
        if (!type || !id) return atom(false)
        if (type === "appRevision") {
            return atom((get) => {
                const queryAtom = defaultProviders.appRevision.selectors.query(id)
                const query = get(queryAtom)
                return query.isError
            })
        } else if (type === "evaluatorRevision") {
            return atom((get) => {
                const queryAtom = defaultProviders.evaluatorRevision.selectors.query(id)
                const query = get(queryAtom)
                return query.isError
            })
        }
        return atom(false)
    }, [type, id])

    // Get dirty atom
    const dirtyAtom = useMemo(() => {
        if (!type || !id) return atom(false)
        if (type === "appRevision") {
            return defaultProviders.appRevision.selectors.isDirty(id)
        } else if (type === "evaluatorRevision") {
            return defaultProviders.evaluatorRevision.selectors.isDirty(id)
        }
        return atom(false)
    }, [type, id])

    const data = useAtomValue(dataAtom)
    const isLoading = useAtomValue(loadingAtom)
    const isError = useAtomValue(errorAtom)
    const isDirty = useAtomValue(dirtyAtom)

    // Local execution state
    const [isExecuting, setIsExecuting] = useState(false)
    const [lastResult, setLastResult] = useState<ExecutionResult | null>(null)

    // Execute function
    const execute = useCallback(
        async (inputData: Record<string, unknown>): Promise<ExecutionResult | null> => {
            if (!data || !type) return null
            setIsExecuting(true)
            try {
                const result = await executeRunnable(type, data, {inputs: inputData})
                setLastResult(result)
                return result
            } finally {
                setIsExecuting(false)
            }
        },
        [data, type],
    )

    // Input/output ports
    const inputPorts = data?.inputPorts || []
    const outputPorts = data?.outputPorts || []

    // Derived state for compatibility
    const isReady = !isLoading && !isError && !!data
    const canExecute = isReady && !isExecuting
    const inputsSatisfied = inputPorts.every(
        (input) => !input.required || input.value !== undefined,
    )
    const config = data?.configuration || {}

    // Discard atom for appRevision
    const discardAppRevision = useSetAtom(appRevisionMolecule.actions.discard)

    // Discard function (resets to server state)
    const discard = useCallback(() => {
        if (!type || !id) return
        if (type === "appRevision") {
            discardAppRevision(id)
        }
        // Note: evaluatorRevision is a stub without discard support
    }, [type, id, discardAppRevision])

    return {
        data,
        isLoading,
        execute,
        inputPorts,
        outputPorts,
        // Aliases for backwards compatibility with existing components
        inputs: inputPorts,
        outputs: outputPorts,
        isPending: isLoading,
        isError,
        isDirty,
        isExecuting,
        lastResult,
        // Additional properties expected by PlaygroundTest components
        isReady,
        canExecute,
        inputsSatisfied,
        config,
        discard,
    }
}
