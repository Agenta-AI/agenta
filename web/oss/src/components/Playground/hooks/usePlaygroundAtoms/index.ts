import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

// Legacy types/helpers removed with new playground state

import {generationBaselineTurnIdsAtom} from "@/oss/state/generation/compat"
import {inputRowIdsAtom} from "@/oss/state/generation/entities"

import {
    addVariantMutationAtom,
    cancelTestsMutationAtom,
    clearTestResultsMutationAtom,
    displayedVariantsAtom,
    deleteVariantMutationAtom,
    playgroundStateAtom,
    rerunChatOutputMutationAtom,
    revisionListAtom,
    saveVariantMutationAtom,
    selectedVariantsAtom,
    setDisplayedVariantsMutationAtom,
    setSelectedVariantMutationAtom,
    triggerWebWorkerTestAtom,
    updateVariantPropertyEnhancedMutationAtom,
    variantByRevisionIdAtomFamily,
} from "../../state/atoms"
import {appChatModeAtom} from "../../state/atoms/app"
import type {UsePlaygroundAtomsReturn, GenerationData} from "../../state/types"
import {findPropertyInObject} from "../usePlayground/assets/helpers"
import {runAllChatForDisplayedVariantsMutationAtom} from "../../state/atoms/generationMutations"

/**
 * Hook to access playground state and mutations using Jotai atoms
 */
export function usePlaygroundAtoms({
    variantId,
    _propertyId,
}: {variantId?: string; _propertyId?: string} = {}): UsePlaygroundAtomsReturn {
    // Get selected variants for comparison mode
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const displayedVariants = useAtomValue(displayedVariantsAtom)
    const enhancedRevisions = useAtomValue(revisionListAtom)
    const playgroundState = useAtomValue(playgroundStateAtom)
    const generationData = playgroundState.generationData || {
        inputs: {value: [], __metadata: {}},
        messages: {value: [], __metadata: {}},
    }

    // Get current variant (enhanced revision) by selected revision id via selector atom
    const selectedId = (displayedVariants && displayedVariants[0]) || selectedVariants[0]
    const currentVariantAtom = useMemo(
        () => variantByRevisionIdAtomFamily(selectedId || "__none__"),
        [selectedId],
    )
    const currentVariant = useAtomValue(currentVariantAtom)

    // Variants are the enhanced revisions directly (single source of truth)
    const variants = useMemo(() => enhancedRevisions || [], [enhancedRevisions])

    // Get mutation functions
    const updateVariantProperty = useSetAtom(updateVariantPropertyEnhancedMutationAtom)
    const setSelectedVariant = useSetAtom(setSelectedVariantMutationAtom)
    const setDisplayedVariants = useSetAtom(setDisplayedVariantsMutationAtom)

    // CRUD operations
    const addVariant = useSetAtom(addVariantMutationAtom)
    const saveVariant = useSetAtom(saveVariantMutationAtom)
    const deleteVariant = useSetAtom(deleteVariantMutationAtom)

    // Web worker integration (atoms only, no hook here to prevent multiple instances)
    const triggerWebWorkerTest = useSetAtom(triggerWebWorkerTestAtom)

    // Test execution with web worker integration
    const cancelTestsOriginal = useSetAtom(cancelTestsMutationAtom)
    const rerunChatOutputOriginal = useSetAtom(rerunChatOutputMutationAtom)
    const clearTestResults = useSetAtom(clearTestResultsMutationAtom)

    // Get the current playground state directly (not cached)
    const currentPlaygroundState = useAtomValue(playgroundStateAtom)

    // Enhanced runTests that integrates with web worker
    const isChatApp = useAtomValue(appChatModeAtom)
    const baselineTurnIds = useAtomValue(generationBaselineTurnIdsAtom)
    const normalizedInputRowIds = useAtomValue(inputRowIdsAtom)
    const runAllChat = useSetAtom(runAllChatForDisplayedVariantsMutationAtom)

    const runTests = useCallback(
        (rowId?: string, variantId?: string) => {
            // Use the CURRENT state inputs, not the cached generationData
            const currentInputs = currentPlaygroundState.generationData.inputs.value || []

            // Handle different execution modes
            if (rowId) {
                // Single row execution - use web worker only to avoid conflicts
                if (variantId) {
                    // Single variant mode
                    triggerWebWorkerTest({
                        rowId,
                        variantId,
                    })
                } else {
                    // Comparison mode: trigger for all displayed variants
                    displayedVariants.forEach((displayedVariantId) => {
                        triggerWebWorkerTest({
                            rowId,
                            variantId: displayedVariantId,
                        })
                    })
                }
            } else {
                // Run all mode
                if (isChatApp) {
                    // Chat: only run the last logical row with valid user content
                    runAllChat()
                    return
                }

                // Completion: iterate through normalized input rows; fallback to legacy if empty
                const inputIds = (normalizedInputRowIds || []) as string[]
                const inputRows = currentInputs

                if (process.env.NODE_ENV === "development") {
                    console.log("🔍 [runTests] Run all (completion) debug:", {
                        normalizedCount: inputIds.length,
                        normalizedIds: inputIds,
                        legacyCount: inputRows.length,
                        selectedVariantsCount: selectedVariants.length,
                        selectedVariants,
                    })
                }

                if (inputIds.length === 0 && inputRows.length === 0) {
                    if (process.env.NODE_ENV === "development") {
                        console.warn("⚠️ [runTests] No input rows found for run all")
                    }
                    return
                }

                if (selectedVariants.length === 0) {
                    if (process.env.NODE_ENV === "development") {
                        console.warn("⚠️ [runTests] No displayed variants found for run all")
                    }
                    return
                }

                if (inputIds.length > 0) {
                    inputIds.forEach((currentRowId, index) => {
                        if (!currentRowId) return
                        if (process.env.NODE_ENV === "development") {
                            console.log(
                                `🚀 [runTests] Triggering tests for row ${index + 1}/${
                                    inputIds.length
                                }:`,
                                {rowId: currentRowId, variantCount: displayedVariants.length},
                            )
                        }
                        displayedVariants.forEach((selectedVariantId) => {
                            triggerWebWorkerTest({
                                rowId: currentRowId,
                                variantId: selectedVariantId,
                            })
                        })
                    })
                } else {
                    inputRows.forEach((row, index) => {
                        const currentRowId = row.__id
                        if (currentRowId) {
                            if (process.env.NODE_ENV === "development") {
                                console.log(
                                    `🚀 [runTests] Triggering tests for row ${index + 1}/${inputRows.length}:`,
                                    {
                                        rowId: currentRowId,
                                        variantCount: displayedVariants.length,
                                        variants: displayedVariants,
                                    },
                                )
                            }
                            displayedVariants.forEach((selectedVariantId) => {
                                triggerWebWorkerTest({
                                    rowId: currentRowId,
                                    variantId: selectedVariantId,
                                })
                            })
                        } else {
                            if (process.env.NODE_ENV === "development") {
                                console.warn(`⚠️ [runTests] Row ${index + 1} missing __id:`, row)
                            }
                        }
                    })
                }
            }
        },
        [
            triggerWebWorkerTest,
            displayedVariants,
            currentPlaygroundState,
            isChatApp,
            baselineTurnIds,
            normalizedInputRowIds,
        ],
    )

    // Enhanced cancelTests wrapper
    const cancelRunTests = useCallback(
        (rowId?: string, variantId?: string) => {
            if (rowId) {
                cancelTestsOriginal({rowId, variantId})
            } else {
                // Cancel all tests
                cancelTestsOriginal({})
            }
        },
        [cancelTestsOriginal],
    )

    // Enhanced rerunChatOutput that handles both truncation and web worker triggering
    const rerunChatOutput = useCallback(
        (messageId: string, variantId?: string) => {
            // Step 1: Truncate conversation using the atom
            const messageRow = rerunChatOutputOriginal(messageId, variantId)

            if (!messageRow) {
                console.error("Message row not found for rerun:", messageId)
                return
            }

            // Step 2: Set up test run state
            const targetVariantIds = variantId ? [variantId] : displayedVariants
            targetVariantIds.forEach((vId) => {
                triggerWebWorkerTest({
                    rowId: messageRow.__id,
                    variantId: vId,
                })
            })
        },
        [rerunChatOutputOriginal, currentPlaygroundState, displayedVariants, triggerWebWorkerTest],
    )

    // Enhanced parameter update handler
    const handleParamUpdate = useCallback(
        (e: {target: {value: any}} | any, propId?: string, vId?: string) => {
            updateVariantProperty({
                variantId:
                    vId || (displayedVariants && displayedVariants[0]) || selectedVariants[0],
                propertyId: propId || _propertyId || "",
                value: e?.target?.value ?? e,
                fallbackVariantId: variantId,
                fallbackPropertyId: _propertyId,
            })
        },
        [],
    )

    // Property getter function to access properties by ID
    const propertyGetter = useCallback(
        (propertyId: string) => {
            // First try to find in generation data (for generation messages)
            if (generationData?.messages?.value) {
                for (const messageRow of generationData.messages.value) {
                    if (messageRow?.history?.value) {
                        for (const message of messageRow.history.value) {
                            const property = findPropertyInObject(message, propertyId)
                            if (property) return property
                        }
                    }
                }
            }

            // Then try to find in current variant (for config messages and other properties)
            if (currentVariant) {
                const property = findPropertyInObject(currentVariant, propertyId)
                if (property) return property
            }

            // Fallback: search in all variants
            for (const variant of variants) {
                const property = findPropertyInObject(variant, propertyId)
                if (property) return property
            }

            return undefined
        },
        [generationData, currentVariant, variants],
    )

    // Map displayedVariants IDs to actual variant objects
    const displayedVariantObjects = displayedVariants
        .map((id: string) => variants.find((v: any) => v.id === id))
        .filter(Boolean) as any[]

    return {
        // State selectors
        variants,
        selectedVariants,
        displayedVariants: displayedVariantObjects,
        currentVariant,
        viewType: selectedVariants.length > 1 ? "comparison" : "single",
        generationData: generationData as unknown as GenerationData,
        testRunStates: {}, // TODO: implement

        // Dirty state
        isAnyVariantDirty: false, // TODO: implement
        dirtyVariantIds: [], // TODO: implement
        isVariantDirty: () => false, // TODO: implement

        // Handlers
        handleParamUpdate,

        // UI mutations
        setSelectedVariant,
        setDisplayedVariants,

        // Variant mutations
        updateVariantProperty,
        updateVariantPropertyEnhanced: updateVariantProperty,
        // Legacy no-op: variant-wide local cache is removed in new setup
        mutateVariant: useCallback(async (..._args: any[]) => {
            if (process.env.NODE_ENV === "development") {
                console.warn(
                    "mutateVariant is deprecated in new playground state; use property mutations",
                )
            }
        }, []) as any,

        // CRUD operations
        addVariant,
        saveVariant,
        deleteVariant,

        // Test execution
        runTests,
        cancelRunTests,
        rerunChatOutput,
        clearTestResults,

        // Property access
        propertyGetter,
    }
}
