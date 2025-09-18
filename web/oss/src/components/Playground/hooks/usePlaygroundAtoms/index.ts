import {useCallback, useMemo} from "react"

import {useAtomValue, useSetAtom} from "jotai"

// Legacy types/helpers removed with new playground state

import {triggerWebWorkerTestAtom} from "@/oss/state/newPlayground/mutations/webWorkerIntegration"

import {
    addVariantMutationAtom,
    cancelTestsMutationAtom,
    clearTestResultsMutationAtom,
    displayedVariantsAtom,
    deleteVariantMutationAtom,
    // rerunChatOutputMutationAtom,
    revisionListAtom,
    saveVariantMutationAtom,
    selectedVariantsAtom,
    setDisplayedVariantsMutationAtom,
    setSelectedVariantMutationAtom,
    updateVariantPropertyEnhancedMutationAtom,
    variantByRevisionIdAtomFamily,
} from "../../state/atoms"
import type {UsePlaygroundAtomsReturn, GenerationData} from "../../state/types"
import {findPropertyInObject} from "../usePlayground/assets/helpers"

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
    // Legacy generationData removed; do not read playgroundStateAtom
    const generationData = useMemo(
        () => ({
            inputs: {value: [], __metadata: {}},
            messages: {value: [], __metadata: {}},
        }),
        [],
    ) as any

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
    // const rerunChatOutputOriginal = useSetAtom(rerunChatOutputMutationAtom)
    const clearTestResults = useSetAtom(clearTestResultsMutationAtom)

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
    // const rerunChatOutput = useCallback(
    //     (messageId: string, variantId?: string) => {
    //         // Step 1: Truncate conversation using the atom
    //         const messageRow = rerunChatOutputOriginal(messageId, variantId)

    //         if (!messageRow) {
    //             console.error("Message row not found for rerun:", messageId)
    //             return
    //         }

    //         // Step 2: Set up test run state
    //         const targetVariantIds = variantId ? [variantId] : displayedVariants
    //         targetVariantIds.forEach((vId) => {
    //             triggerWebWorkerTest({
    //                 rowId: messageRow.__id,
    //                 variantId: vId,
    //             })
    //         })
    //     },
    //     [rerunChatOutputOriginal, displayedVariants, triggerWebWorkerTest],
    // )

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
        [currentVariant, variants],
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
        // runTests,
        cancelRunTests,
        // rerunChatOutput,
        clearTestResults,

        // Property access
        propertyGetter,
    }
}
