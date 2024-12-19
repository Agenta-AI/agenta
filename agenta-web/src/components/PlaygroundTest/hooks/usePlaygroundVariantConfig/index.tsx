import {useCallback, useMemo} from "react"
import cloneDeep from "lodash/cloneDeep"

import {accessKeyInVariant, setKeyInVariant} from "../../assets/helpers"
import type {InitialStateType, StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import {Path} from "../../types"
import usePlaygroundVariant from "../usePlaygroundVariant"
import {
    ConfigValue,
    InferSchemaType,
    PropertyConfig,
    UsePlaygroundVariantConfigReturn,
} from "./types"
import {isSchemaObject} from "./assets/helpers"
import { compareVariant } from "../usePlaygroundState/assets/helpers"

function usePlaygroundVariantConfig<
    CK extends Path<StateVariant> & string,
    VK extends Path<StateVariant> & string,
>(
    options: Omit<UsePlaygroundStateOptions, "selector"> & {
        configKey: CK
        valueKey: VK
        variantId: string
    },
): UsePlaygroundVariantConfigReturn<StateVariant, CK, VK> {
    const {configKey, valueKey, variantId, ...stateOptions} = options

    const {variant, mutateVariant} = usePlaygroundVariant({
        ...stateOptions,
        variantId,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateOnMount: false,
        compare: useCallback(
            (a: InitialStateType | undefined, b: InitialStateType | undefined) => {
                return (
                    compareVariant(a, b, variantId, options?.compare, configKey) &&
                    compareVariant(a, b, variantId, options?.compare, valueKey)
                );
            },
            [variantId, options?.compare, configKey, valueKey]
        ),
    })

    const handleParamUpdate = useCallback(
        (e: {target: {value: ConfigValue}} | ConfigValue) => {
            const val = e ? (typeof e === "object" && "target" in e ? e.target.value : e) : null

            if (!variant) return
            const updatedVariant = cloneDeep(variant)
            setKeyInVariant(valueKey, updatedVariant, val)
            mutateVariant(updatedVariant)
        },
        [valueKey, variant, mutateVariant],
    )

    // Rest of the hook implementation remains the same
    const returnValues = useMemo(() => {
        const rawConfig = variant
            ? accessKeyInVariant<StateVariant, CK>(configKey, variant)
            : undefined
        const config = rawConfig && isSchemaObject(rawConfig) ? rawConfig : undefined
        const rawValue = variant
            ? accessKeyInVariant<StateVariant, VK>(valueKey, variant)
            : undefined

        // Use the improved type inference
        const value = config ? (rawValue as InferSchemaType<typeof config>) : undefined

        const property: PropertyConfig<StateVariant, CK, VK, typeof config> = {
            config,
            valueInfo: value,
            handleChange: handleParamUpdate,
        }

        return {
            config,
            value,
            property,
        } as const
    }, [variant, configKey, valueKey, handleParamUpdate])
    
    return returnValues as UsePlaygroundVariantConfigReturn<
        StateVariant,
        CK,
        VK,
        typeof returnValues.config
    >
}

export default usePlaygroundVariantConfig
