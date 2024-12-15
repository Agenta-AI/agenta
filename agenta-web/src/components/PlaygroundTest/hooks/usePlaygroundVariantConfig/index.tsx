import isEqual from "lodash/isEqual"
import {accessKeyInVariant} from "../../assets/helpers"
import usePlaygroundState from "../usePlaygroundState"
import type {InitialStateType, StateVariant} from "../../state/types"
import type {UsePlaygroundVariantConfigOptions, UsePlaygroundVariantConfigReturn} from "./types"
import {useCallback, useMemo} from "react"
import cloneDeep from "lodash/cloneDeep"
import type {ConfigPropertyType} from "../../state/types"

function usePlaygroundVariantConfig<T = any>(
    options: UsePlaygroundVariantConfigOptions,
): UsePlaygroundVariantConfigReturn<T> {
    const {configKey, variantId, ...stateOptions} = options

    const {variants, mutate} = usePlaygroundState({
        ...stateOptions,
        compare:
            useCallback(
                (a: InitialStateType | undefined, b: InitialStateType | undefined) => {
                    const variantsA = a?.variants || []
                    const variantsB = b?.variants || []

                    const variantA = variantsA.find((v) => v.variantId === variantId)
                    const variantB = variantsB.find((v) => v.variantId === variantId)

                    if (!!variantA && !!variantB && !isEqual(variantA, variantB)) {
                        const paramsA = accessKeyInVariant(configKey, variantA)
                        const paramsB = accessKeyInVariant(configKey, variantB)

                        return isEqual(paramsA, paramsB)
                    }
                    return isEqual(a, b)
                },
                [configKey, variantId],
            ),
    })

    const mutateVariant = useCallback(
        (variantId: string, val: string | boolean | string[] | number) => {
            mutate(
                (state) => {
                    if (!state) return state
                    const clone = cloneDeep(state)

                    const updateVariant = (variant: StateVariant): StateVariant => {    
                        const previousParam = accessKeyInVariant(configKey, variant) as ConfigPropertyType;
                        if (previousParam && previousParam.default !== val) {
                            previousParam.default = val;
                            return variant;
                        }
                        return variant;
                    }
                    clone.variants = clone.variants.map((v) =>
                        v.variantId === variantId ? updateVariant(v) : cloneDeep(v),
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
        return {
            variant,
            config,
            mutateVariant,
        }
    }, [variants, variantId, configKey, mutateVariant])

    return returnValues
}

export type {UsePlaygroundVariantConfigOptions, UsePlaygroundVariantConfigReturn}
export default usePlaygroundVariantConfig
