import {type MouseEvent, useCallback} from "react"
import isEqual from "lodash/isEqual"
import type {Key} from "swr"
import usePlaygroundState from "../usePlaygroundState"
import type {UsePlaygroundVariantsReturn, UsePlaygroundVariantsOptions} from "./types"
import type {
    StateMiddleware,
    InitialStateType,
    UsePlaygroundStateOptions,
    StateVariant,
} from "../../state/types"
import cloneDeep from "lodash/cloneDeep"
import {v4 as uuidv4} from "uuid"

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
        compare: useCallback<NonNullable<UsePlaygroundStateOptions["compare"]>>(
            (a: InitialStateType | undefined, b: InitialStateType | undefined) => {
                const test = () => {
                    const variantsA = a?.variants
                    const variantsB = b?.variants

                    if (!!variantsA && !!variantsB && !isEqual(variantsA, variantsB)) {
                        const keysA = variantsA.map((v) => v.variantId)
                        const keysB = variantsB.map((v) => v.variantId)

                        return (
                            keysA.length === keysB.length &&
                            keysA.every((key) => keysB.includes(key))
                        )
                    }
                    return isEqual(a, b)
                }

                return options?.compare ? options.compare(a, b) : test()
            },
            [options],
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
