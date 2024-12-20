import { useCallback, useMemo } from "react"
import cloneDeep from "lodash/cloneDeep"
import { accessKeyInVariant, setKeyInVariant } from "../../assets/helpers"
import usePlaygroundVariant from "../usePlaygroundVariant"
import { isSchemaObject } from "./assets/helpers"
import { compareVariant } from "../usePlaygroundState/assets/helpers"
import type { SchemaObject } from "../../types/shared"
import type { Path } from "../../types/pathHelpers"
import type { InitialStateType, StateVariant } from "../../state/types"
import type { UsePlaygroundStateOptions } from "../usePlaygroundState/types"

// Basic value types
export type ConfigValue = string | boolean | string[] | number | null

// Simple property interface to avoid deep recursion
export interface PlaygroundVariantProperty {
    config: SchemaObject
    valueInfo: unknown
    handleChange: (e: { target: { value: ConfigValue } } | ConfigValue) => void
}

// Hook return type
export interface PlaygroundVariantConfigReturn {
    property: PlaygroundVariantProperty | undefined
}

function usePlaygroundVariantConfig({
    configKey,
    valueKey,
    variantId,
    ...stateOptions
}: Omit<UsePlaygroundStateOptions, "selector"> & {
    configKey: Path<StateVariant>
    valueKey: Path<StateVariant>
    variantId: string
}): PlaygroundVariantConfigReturn {
    const { variant, mutateVariant } = usePlaygroundVariant({
        ...stateOptions,
        variantId,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        revalidateOnMount: false,
        compare: useCallback(
            (a: InitialStateType | undefined, b: InitialStateType | undefined) => {
                return (
                    compareVariant(a, b, variantId, stateOptions?.compare, configKey) &&
                    compareVariant(a, b, variantId, stateOptions?.compare, valueKey)
                )
            },
            [variantId, stateOptions?.compare, configKey, valueKey]
        ),
    })

    const handleParamUpdate = useCallback(
        (e: { target: { value: ConfigValue } } | ConfigValue) => {
            const val = e ? (typeof e === "object" && "target" in e ? e.target.value : e) : null
            if (!variant) return
            const updatedVariant = cloneDeep(variant)
            setKeyInVariant(valueKey, updatedVariant, val)
            mutateVariant(updatedVariant)
        },
        [valueKey, variant, mutateVariant]
    )

    const config = useMemo(() => {
        const rawConfig = variant ? accessKeyInVariant(configKey, variant) : undefined
        return rawConfig && isSchemaObject(rawConfig) ? rawConfig : undefined
    }, [configKey, variant])

    console.log('variant config', config, variant, valueKey, configKey)

    return useMemo(() => {
        const valueInfo = variant ? accessKeyInVariant(valueKey, variant) : undefined

        return {
            property: config
                ? {
                      config,
                      valueInfo,
                      handleChange: handleParamUpdate,
                  }
                : undefined,
        }
    }, [variant, valueKey, handleParamUpdate, config])
}

export default usePlaygroundVariantConfig

