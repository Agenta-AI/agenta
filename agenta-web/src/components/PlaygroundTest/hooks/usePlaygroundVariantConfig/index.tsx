import {accessKeyInVariant, setKeyInVariant} from "../../assets/helpers"
import usePlaygroundState from "../usePlaygroundState"
import type {InitialStateType, StateVariant} from "../../state/types"
import type {UsePlaygroundVariantConfigOptions, UsePlaygroundVariantConfigReturn} from "./types"
import {useCallback, useMemo} from "react"
import cloneDeep from "lodash/cloneDeep"
import type {ConfigPropertyType} from "../../state/types"
import {compareVariant} from "../usePlaygroundState/assets/helpers"

function usePlaygroundVariantConfig<T = any>(
    options: UsePlaygroundVariantConfigOptions,
): UsePlaygroundVariantConfigReturn<T> {
    const {configKey, valueKey, variantId, ...stateOptions} = options

    const {variants, mutate} = usePlaygroundState({
        ...stateOptions,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateOnMount: false,
        compare: useCallback(
            (a: InitialStateType | undefined, b: InitialStateType | undefined) => {
                return (
                    compareVariant(a, b, variantId, options?.compare, configKey) &&
                    compareVariant(a, b, variantId, options?.compare, valueKey)
                )
            },
            [configKey, variantId, options?.compare],
        ),
    })

    const mutateVariant = useCallback(
        (variantId: string, val: string | boolean | string[] | number | null) => {
            mutate(
                (state) => {
                    if (!state) return state
                    const clone = cloneDeep(state)

                    const updateVariant = (variant: StateVariant): StateVariant => {
                        const previousParam = accessKeyInVariant(
                            valueKey,
                            variant,
                        ) as ConfigPropertyType["value"]
                        if (
                            previousParam !== val
                        ) {
                            setKeyInVariant(
                                valueKey,
                                variant,
                                val,
                            )
                            return variant
                        }
                        return variant
                    }
                    clone.variants = clone.variants.map((v) =>
                        v.variantId === variantId ? updateVariant(v) : v,
                    )
                    return clone
                },
                {
                    revalidate: false,
                },
            )
        },
        [configKey, mutate],
    )

    const returnValues = useMemo(() => {
        const variant = variants?.find((v) => v.variantId === variantId)
        const config = variant ? (accessKeyInVariant(configKey, variant) as T) : undefined
        const value = variant ? (accessKeyInVariant(valueKey, variant) as T) : undefined

        interface HandleParamUpdateEvent {
            target: {
                value: string | boolean | string[] | null | number
            }
        }

        const handleParamUpdate = (
            e: HandleParamUpdateEvent | string | boolean | string[] | null | number,
        ) => {
            const val = !!e
                ? Array.isArray(e)
                    ? e
                    : typeof e === "object"
                      ? e.target.value
                      : e
                : null
            console.log("handle param update", val, configKey, valueKey, config, variant)
            mutateVariant(variantId, val)
        }

        const property = {
            config,
            valueInfo: value,
            handleChange: (
                e: HandleParamUpdateEvent | string | boolean | string[] | null | number,
            ) => handleParamUpdate(e),
        }

        return {
            variant,
            config,
            value,
            mutateVariant,
            property,
        }
    }, [variants, variantId, configKey, valueKey, mutateVariant])

    return returnValues
}

export type {UsePlaygroundVariantConfigOptions, UsePlaygroundVariantConfigReturn}
export default usePlaygroundVariantConfig
