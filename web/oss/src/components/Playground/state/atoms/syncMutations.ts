import {produce} from "immer"
import {atom} from "jotai"

import type {ArrayMetadata, ObjectMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {createInputRow} from "@/oss/lib/shared/variant/inputHelpers"

import {playgroundStateAtom} from "./core"
import {displayedVariantsVariablesAtom} from "./variants"

/**
 * Sync Mutations
 *
 * These mutations handle synchronization of data across variants,
 * particularly for keeping input variables in sync across all displayed variants
 */

/**
 * Cross-variant input synchronization mutation
 * Ensures all displayed variants have consistent input variables
 */
export const syncCrossVariantInputsMutationAtom = atom(null, (get, set) => {
    try {
        // Get all variables from displayed variants
        const allVariables = get(displayedVariantsVariablesAtom)

        // Update playground state - ONLY sync inputs, never messages
        // Cross-variant sync should only affect input variables, not chat messages
        set(playgroundStateAtom, (prevState) =>
            produce(prevState, (draft) => {
                // ALWAYS target inputs, regardless of variant type
                // Messages have their own structure (role, content, history) and should not be synced
                const inputData = draft.generationData?.inputs
                if (!inputData) {
                    if (process.env.NODE_ENV === "development") {
                        console.warn("❌ [syncCrossVariantInputs] No generation data inputs found")
                    }
                    return
                }

                // Update the input data structure only
                const inputRows = inputData.value || []

                // Create input schema from all variables
                const inputSchema = {
                    type: "object",
                    properties: allVariables.reduce(
                        (acc, variable) => {
                            acc[variable] = {
                                type: "string",
                                title: variable,
                                description: `Template variable: {{${variable}}}`,
                            }
                            return acc
                        },
                        {} as Record<string, any>,
                    ),
                }

                // Update metadata to include all variables
                const arrayMetadata: ArrayMetadata<ObjectMetadata> = {
                    type: "array",
                    itemMetadata: {
                        type: "object",
                        properties: inputSchema.properties,
                    },
                }

                // Update metadata for input data structure
                inputData.__metadata = arrayMetadata

                // Update existing input rows to include all variables
                const existingRows = inputRows

                if (existingRows.length === 0) {
                    // Create a new input row if none exist
                    const newRow = createInputRow(allVariables, arrayMetadata.itemMetadata)
                    inputData.value = [newRow]
                } else {
                    // Update existing input rows to include all variables AND remove obsolete ones
                    existingRows.forEach((row: any) => {
                        // First, remove obsolete variables that are no longer in templates
                        const currentKeys = Object.keys(row).filter((key) => !key.startsWith("__"))
                        const obsoleteKeys = currentKeys.filter(
                            (key) => !allVariables.includes(key),
                        )

                        obsoleteKeys.forEach((obsoleteKey) => {
                            delete row[obsoleteKey]
                        })

                        // Then, add missing variables
                        allVariables.forEach((variable) => {
                            if (!row[variable]) {
                                // Add missing variable with empty value
                                row[variable] = {
                                    __id: `${row.__id}-${variable}`,
                                    value: "",
                                    __metadata: {
                                        type: "string",
                                        title: variable,
                                        description: `Template variable: {{${variable}}}`,
                                    },
                                }
                            }
                        })
                    })
                }
            }),
        )
    } catch (error) {
        if (process.env.NODE_ENV === "development") {
            console.error("❌ [syncCrossVariantInputs] Error:", error)
        }
        throw error
    }
})

/**
 * Automatic Generation Data Sync Atom
 * This derived atom automatically keeps generation data inputs in sync
 * with variables from all displayed variants. No manual triggering needed.
 */
export const autoSyncedGenerationDataAtom = atom((get) => {
    const playgroundState = get(playgroundStateAtom)
    const allVariables = get(displayedVariantsVariablesAtom)

    if (!playgroundState.generationData?.inputs) {
        return playgroundState.generationData
    }

    // Create updated generation data with synced variables
    const updatedGenerationData = produce(playgroundState.generationData, (draft) => {
        if (!draft.inputs) return

        // Initialize metadata array if it doesn't exist
        if (!draft.inputs.metadata) {
            draft.inputs.metadata = []
        }

        // Initialize value array if it doesn't exist
        if (!draft.inputs.value) {
            draft.inputs.value = []
        }

        // Get current input keys
        const currentKeys = draft.inputs.metadata.map((meta: any) => meta.key) || []
        const newKeys = allVariables.filter((key) => !currentKeys.includes(key))
        const obsoleteKeys = currentKeys.filter((key: string) => !allVariables.includes(key))

        // Add new variable metadata
        newKeys.forEach((key) => {
            draft.inputs.metadata.push({
                __id: `input-${key}-${Date.now()}`,
                key,
                type: "string",
                required: false,
            })
        })

        // Remove obsolete variable metadata
        draft.inputs.metadata = draft.inputs.metadata.filter(
            (meta: any) => !obsoleteKeys.includes(meta.key),
        )

        // Update all input rows to include new variables and remove obsolete ones
        draft.inputs.value.forEach((row: any) => {
            // Add new variables with empty values
            newKeys.forEach((key) => {
                if (!row.hasOwnProperty(key)) {
                    row[key] = {
                        __id: `value-${key}-${row.__id}-${Date.now()}`,
                        value: "",
                    }
                }
            })

            // Remove obsolete variables
            obsoleteKeys.forEach((key: string) => {
                delete row[key]
            })
        })

        // CRITICAL FIX: Preserve existing messages data with history
        // The sync atom should only update inputs, not overwrite messages
        // Messages data should be preserved as-is to maintain chat history
        if (playgroundState.generationData.messages) {
            draft.messages = playgroundState.generationData.messages
        }
    })

    return updatedGenerationData
})

/**
 * Note: syncedGenerationDataAtom has been removed to enforce single source of truth
 * All components now use playgroundStateAtom.generationData directly
 * This eliminates data consistency issues and simplifies the architecture
 */

/**
 * Auto-sync effect atom that triggers cross-variant input sync
 * when displayed variants or their variables change
 * @deprecated Use autoSyncedGenerationDataAtom instead for better performance
 */
export const autoSyncCrossVariantInputsEffectAtom = atom(
    (get) => {
        // Subscribe to displayed variants variables to trigger sync
        const variables = get(displayedVariantsVariablesAtom)
        return variables
    },
    (get, set, _variables: string[]) => {
        // Trigger sync when variables change
        set(syncCrossVariantInputsMutationAtom)
    },
)
