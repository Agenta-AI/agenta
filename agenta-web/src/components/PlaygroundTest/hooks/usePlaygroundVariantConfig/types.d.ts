import type {StateVariant, UsePlaygroundStateOptions} from "../../state/types"

export interface UsePlaygroundVariantConfigOptions
    extends Omit<UsePlaygroundStateOptions, "selector"> {
    configKey: string
    variantId: string
}

export interface UsePlaygroundVariantConfigReturn<T = any> {
    variant: StateVariant | undefined
    config: T | undefined
    mutateVariant: (variantId: string, val: string | boolean | string[] | number) => void
}
