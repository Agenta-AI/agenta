import {useCallback, useMemo} from "react"
import usePlaygroundVariants from "../usePlaygroundVariants"
import type {StateVariant} from "../../state/types"
import {message} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {useSWRConfig} from "swr"
import {UsePlaygroundVariantOptions, UsePlaygroundVariantReturn} from "./types"
import {AxiosResponse} from "axios"

/**
 * Hook for managing a single variant in the playground
 *
 * @param options - Configuration options for the hook
 * @param options.variantId - Unique identifier for the variant to manage
 * @inheritdoc Inherits all options from usePlaygroundVariants hook
 * @throws {Error} When variantId is not provided
 *
 * @returns {UsePlaygroundVariantReturn} Object containing:
 * - variant: The current variant state
 * - deleteVariant: Function to delete the current variant
 * - mutateVariant: Function to update the variant's properties
 *
 * @example
 * ```typescript
 * const { variant, deleteVariant, mutateVariant } = usePlaygroundVariant({
 *   variantId: "123"
 * });
 * ```
 */
const usePlaygroundVariant = (options: UsePlaygroundVariantOptions): UsePlaygroundVariantReturn => {
    if (!options.variantId) {
        throw new Error("variantId is required for usePlaygroundVariant hook")
    }

    const {fetcher} = useSWRConfig()
    const swr = usePlaygroundVariants({
        ...options,
    })
    const {variants, mutate, projectId} = swr

    const variant = useMemo(() => {
        return variants?.find((v) => v.variantId === options.variantId)
    }, [options.variantId, variants])

    /**
     * Deletes the current variant from the server and updates local state
     * @returns Promise that resolves when the deletion is complete
     */
    const deleteVariant = useCallback(async () => {
        await mutate(
            async (state) => {
                if (!variant) return state

                try {
                    const deleteResponse = (await fetcher?.(
                        `/api/variants/${variant.variantId}?project_id=${projectId}`,
                        {
                            method: "DELETE",
                        },
                    )) as AxiosResponse

                    if (deleteResponse && deleteResponse?.status !== 200) {
                        // error
                        message.error("Failed to delete variant")
                    }

                    const clonedState = cloneDeep(state)
                    clonedState?.variants?.forEach((v: StateVariant) => {
                        if (v.variantId === variant.variantId) {
                            const index = clonedState.variants.indexOf(v)
                            clonedState.variants.splice(index, 1)
                        }
                    })

                    return clonedState
                } catch (err) {
                    message.error("Failed to delete variant")
                    return state
                }
            },
            {
                revalidate: false,
            },
        )
    }, [mutate, variant, fetcher, projectId])

    const saveVariant = useCallback(async () => {
        await mutate(
            async (state) => {
                if (!variant) return state

                try {
                    console.log("variant", variant)
                    const saveResponse = (await fetcher?.(
                        `/api/variants/${variant.variantId}/parameters?project_id=${projectId}`,
                        {
                            method: "PUT",
                            body: JSON.stringify(variant),
                        },
                    )) as AxiosResponse

                    if (saveResponse && saveResponse?.status !== 200) {
                        // error
                        message.error("Failed to save variant")
                    }

                    return state
                } catch (err) {
                    message.error("Failed to save variant")
                    return state
                }
            },
            {
                revalidate: false,
            },
        )
    }, [fetcher, mutate, projectId, variant])

    /**
     * Updates the current variant with new properties
     * @param updates - Partial variant object containing the properties to update
     */
    const mutateVariant = useCallback(
        async (updates: Partial<StateVariant>) => {
            mutate(
                async (state) => {
                    if (!variant || !state) return state
                    const updatedVariant: StateVariant = {...variant, ...updates}
                    const clonedState = cloneDeep(state)
                    const index = clonedState?.variants?.findIndex(
                        (v) => v.variantId === variant.variantId,
                    )
                    clonedState.variants[index] = updatedVariant
                    return clonedState
                },
                {
                    revalidate: false,
                },
            )
        },
        [variant, mutate],
    )

    return Object.assign({}, swr, {variant, deleteVariant, mutateVariant, saveVariant})
}

export default usePlaygroundVariant
