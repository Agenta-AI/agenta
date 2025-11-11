import {useCallback} from "react"

import type {Key, SWRHook} from "swr"

import {message} from "@/oss/components/AppMessageContext"
import {hashVariant} from "@/oss/components/Playground/assets/hash"
import type {FetcherOptions} from "@/oss/lib/api/types"
import {atomStore, allRevisionsAtom} from "@/oss/lib/hooks/useStatelessVariants/state"

import {isPlaygroundEqual} from "../assets/helpers"
import type {
    PlaygroundStateData,
    PlaygroundMiddleware,
    PlaygroundSWRConfig,
    PlaygroundMiddlewareParams,
    PlaygroundResponse,
    UIState,
    ViewType,
} from "../types"

import usePlaygroundUtilities from "./hooks/usePlaygroundUtilities"

/**
 * Middleware for managing UI state in the playground.
 * Handles variant display states and view type transitions.
 *
 * @description
 * This middleware extends the SWR hook with UI-specific functionality:
 * - Manages which variants are currently displayed
 * - Controls single/comparison view modes
 * - Handles variant selection and toggle states
 *
 * @example
 * ```tsx
 * // Using the UI middleware
 * const { displayedVariants, viewType, setSelectedVariant } = usePlayground()
 *
 * // Toggle variant display
 * const handleVariantToggle = (variantId) => {
 *   toggleVariantDisplay(variantId)
 * }
 *
 * // Check current view type
 * if (viewType === 'comparison') {
 *   // Render comparison view
 * }
 * ```
 */
const playgroundUIMiddleware: PlaygroundMiddleware = (useSWRNext: SWRHook) => {
    return <Data extends PlaygroundStateData = PlaygroundStateData, Selected = unknown>(
        key: Key,
        fetcher: ((url: string, options?: FetcherOptions) => Promise<Data>) | null,
        config: PlaygroundSWRConfig<Data, Selected>,
    ): PlaygroundResponse<Data, Selected> => {
        const useImplementation = ({
            key,
            fetcher,
            config,
        }: PlaygroundMiddlewareParams<Data>): UIState<Data, Selected> => {
            const {logger, valueReferences, addToValueReferences} = usePlaygroundUtilities({
                config: {
                    ...config,
                    name: "playgroundUIMiddleware",
                },
            })

            /**
             * Enhanced SWR hook with UI-specific comparison logic
             * Prevents unnecessary rerenders when only UI state changes
             */
            const swr = useSWRNext(key, fetcher, {
                ...config,
                revalidateOnMount:
                    config.revalidateOnMount ??
                    !(
                        valueReferences.current.includes("displayedVariants") ||
                        valueReferences.current.includes("viewType")
                    ),
                /**
                 * Custom comparison function that handles UI state changes
                 * Only triggers rerender when relevant UI state changes
                 */
                compare: useCallback(
                    (a?: Data, b?: Data) => {
                        const uiStateReferenced =
                            valueReferences.current.includes("displayedVariants") ||
                            valueReferences.current.includes("viewType")

                        logger(`COMPARE - ENTER`, uiStateReferenced)
                        const wrappedComparison = config.compare?.(a, b)

                        if (!uiStateReferenced) {
                            logger(`COMPARE - WRAPPED 1`, wrappedComparison)
                            return wrappedComparison
                        } else {
                            if (wrappedComparison) {
                                logger(
                                    `COMPARE - UI STATE REFERENCED - return wrapped`,
                                    wrappedComparison,
                                )
                                return true
                            } else {
                                const isViewTypeReferenced =
                                    valueReferences.current.includes("viewType")
                                const isDisplayedVariantsReferenced =
                                    valueReferences.current.includes("displayedVariants")

                                if (isDisplayedVariantsReferenced) {
                                    logger(
                                        `COMPARE - DISPLAYED VARIANTS REFERENCED - return COMPARISON`,
                                        wrappedComparison,
                                    )
                                    return isPlaygroundEqual(a?.selected, b?.selected)
                                } else if (isViewTypeReferenced) {
                                    logger(
                                        `COMPARE - VIEW TYPE REFERENCED - return COMPARISON`,
                                        wrappedComparison,
                                    )
                                    return a?.selected?.length === b?.selected?.length
                                }

                                return true
                            }
                        }
                    },
                    [config, logger, valueReferences],
                ),
            } as PlaygroundSWRConfig<Data>) as PlaygroundResponse<Data, Selected>

            /**
             * Returns array of variant IDs that are currently being displayed
             * Used for managing which variants are visible in the UI
             */
            const getDisplayedVariants = useCallback((): string[] => {
                addToValueReferences("displayedVariants")
                return swr.data?.selected || []
            }, [addToValueReferences, swr])

            /**
             * Determines current view type based on number of displayed variants
             * @returns 'comparison' if multiple variants are displayed, 'single' otherwise
             */
            const getViewType = useCallback((): ViewType => {
                addToValueReferences("viewType")
                return (swr.data?.selected?.length || 0) > 1 ? "comparison" : "single"
            }, [addToValueReferences, swr.data?.selected?.length])

            /**
             * Sets a single variant as the selected display variant
             * Useful for switching to single view mode
             * @param variantId - ID of the variant to display
             */
            const setSelectedDisplayVariant = useCallback(
                (variantId: string) => {
                    // Get all transformed revisions from atom store
                    const allRevisions = atomStore.get(allRevisionsAtom) || []

                    swr.mutate(
                        (state) => {
                            if (!state) return state

                            // Update selected ID in state
                            state.selected = [variantId]

                            // Find the selected revision from the atom store
                            const selectedRevision = allRevisions.find(
                                (rev: {id: string}) => rev.id === variantId,
                            )

                            // If we found it in the atom store, use it directly
                            if (selectedRevision) {
                                // Replace variants with just the selected one from our atom
                                state.variants = [selectedRevision]
                                console.log("Retrieved variant from atom store:", variantId)
                            } else {
                                console.warn("Selected variant not found in atom store:", variantId)
                            }

                            return state
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            /**
             * Toggles the display state of a variant
             * Can be used to show/hide variants in comparison view
             * @param variantId - ID of the variant to toggle
             * @param display - Optional forced display state
             */
            const toggleVariantDisplay = useCallback(
                (variantId: string, display?: boolean) => {
                    // Get all revisions from atom store
                    const allRevisions = atomStore.get(allRevisionsAtom) || []

                    swr.mutate(
                        (state) => {
                            if (!state) return state
                            const isInView = state.selected.includes(variantId)
                            const _display = display ?? !isInView

                            if (_display) {
                                // Add to selection
                                const selectedVariants = Array.from(
                                    new Set([...state.selected, variantId]),
                                )
                                state.selected = selectedVariants

                                // Find the revision in the atom store
                                const revisionToAdd = allRevisions.find(
                                    (rev: {id: string}) => rev.id === variantId,
                                )

                                // Only add it to variants if it's not already there
                                if (
                                    revisionToAdd &&
                                    !state.variants.some((v) => v.id === variantId)
                                ) {
                                    state.variants = [...state.variants, revisionToAdd]
                                    console.log("Added variant from atom store:", variantId)
                                }

                                // Get variant name for message
                                const selectedVariantName =
                                    revisionToAdd?.variantName ||
                                    state.variants.find((variant) => variant.id === variantId)
                                        ?.variantName ||
                                    "Unknown"

                                message.success(
                                    `Variant named ${selectedVariantName} added to comparison`,
                                )
                            } else {
                                // Don't allow removing if it's the only one displayed
                                if (state.selected.length === 1) {
                                    message.error("At least one variant must be displayed")
                                    return state
                                } else {
                                    // Before removing from selection, sync any local changes to the atom store
                                    const variantToUnmount = state.variants.find(
                                        (v) => v.id === variantId,
                                    )
                                    if (variantToUnmount) {
                                        // Check if this variant has local changes by comparing with dataRef
                                        const currentHash = hashVariant(variantToUnmount)
                                        const originalHash = state.dataRef?.[variantId]

                                        // If hash is different, this variant has local changes
                                        if (currentHash !== originalHash) {
                                            console.log(
                                                "Syncing locally modified variant to atom store before unmounting:",
                                                variantId,
                                            )

                                            // Update the variant in the atom store to preserve changes
                                            const updatedRevisions = allRevisions.map((rev) =>
                                                rev.id === variantId ? variantToUnmount : rev,
                                            )
                                            atomStore.set(allRevisionsAtom, () => updatedRevisions)
                                        }
                                    }

                                    // Remove from selection
                                    state.selected = state.selected.filter((id) => id !== variantId)
                                }

                                // Get variant name for message
                                const selectedVariantName =
                                    state.variants.find((variant) => variant.id === variantId)
                                        ?.variantName || "Unknown"

                                message.success(
                                    `Variant named ${selectedVariantName} removed from comparison`,
                                )
                            }

                            return state
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            const setDisplayedVariants = useCallback(
                (variants: string[]) => {
                    // Get all revisions from atom store
                    const allRevisions = atomStore.get(allRevisionsAtom) || []

                    console.log("set displayed variants:", {
                        allRevisions,
                        selected: variants,
                    })
                    swr.mutate(
                        (clonedState) => {
                            if (!clonedState) return clonedState

                            // Update the selected variants
                            clonedState.selected = variants

                            // Ensure all selected variants are in the variants array
                            for (const variantId of variants) {
                                if (!clonedState.variants.some((v) => v.id === variantId)) {
                                    const revisionToAdd = allRevisions.find(
                                        (rev: {id: string}) => rev.id === variantId,
                                    )

                                    console.log("set displayed variants 2:", {
                                        revisionToAdd,
                                    })

                                    if (revisionToAdd) {
                                        clonedState.variants.push(revisionToAdd)
                                        console.log(
                                            "Added variant from atom store in setDisplayedVariants:",
                                            variantId,
                                        )
                                    }
                                }
                            }

                            return clonedState
                        },
                        {revalidate: false},
                    )
                },
                [swr],
            )

            // Define getters for UI state and actions
            return Object.defineProperties(swr, {
                displayedVariants: {
                    get: getDisplayedVariants,
                    enumerable: true,
                },
                viewType: {
                    get: getViewType,
                    enumerable: true,
                },
                setSelectedVariant: {
                    get: () => {
                        addToValueReferences("setSelected")
                        return setSelectedDisplayVariant
                    },
                    enumerable: true,
                },
                toggleVariantDisplay: {
                    get: () => {
                        addToValueReferences("toggleVariantDisplay")
                        return toggleVariantDisplay
                    },
                    enumerable: true,
                },
                setDisplayedVariants: {
                    get: () => {
                        addToValueReferences("setDisplayedVariants")
                        return setDisplayedVariants
                    },
                    enumerable: true,
                },
            })
        }

        return useImplementation({key, fetcher, config})
    }
}

export default playgroundUIMiddleware
