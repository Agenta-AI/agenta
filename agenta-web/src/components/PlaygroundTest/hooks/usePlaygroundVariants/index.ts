import {type MouseEvent, useCallback} from "react"
import type {Key} from "swr"
import usePlaygroundState from "../usePlaygroundState"
import type {UsePlaygroundVariantsReturn, UsePlaygroundVariantsOptions} from "./types"
import type {StateMiddleware, InitialStateType, StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import cloneDeep from "lodash/cloneDeep"
import {v4 as uuidv4} from "uuid"
import {createVariantCompare} from "../usePlaygroundState/assets/comparators"

const usePlaygroundVariants = (
    options?: UsePlaygroundVariantsOptions,
): UsePlaygroundVariantsReturn => {
    const {variants, mutate} = usePlaygroundState({
        use: [
            ((swrNext: StateMiddleware) =>
                (
                    key: Key,
                    fetcher: null | (() => Promise<InitialStateType>),
                    config: {cache: Map<string, any>},
                ) => {
                    const cache = config.cache
                    if (!key) return null
                    if (!cache.has(String(key))) {
                        return swrNext(key, fetcher, config)
                    } else {
                        return swrNext(key, null, config)
                    }
                }) as StateMiddleware,
            ...(options?.use || []),
        ],
        neverFetch: options?.neverFetch,
        compare: useCallback<NonNullable<UsePlaygroundStateOptions["compare"]>>(
            (a, b) => createVariantCompare(options?.compare)(a, b),
            [options?.compare],
        ),
        ...options,
        hookId: options?.hookId || "variants-wrapper",
    })

    const addVariant = useCallback(
        (_: MouseEvent, variant?: StateVariant) => {
            mutate(
                (state) => {
                    if (!state) return state

                    const existingVariant = state.variants[state.variants.length - 1]
                    const newVariant = variant
                        ? cloneDeep(variant)
                        : {
                              ...cloneDeep(existingVariant),
                              variantId: uuidv4(),
                          }

                    const clone = cloneDeep(state)
                    clone.variants = [...clone.variants, newVariant]
                    return clone
                },
                {
                    revalidate: false,
                },
            )
        },
        [mutate],
    )

    return {variants: variants || [], addVariant}
}

export type {UsePlaygroundVariantsOptions, UsePlaygroundVariantsReturn}
export default usePlaygroundVariants
