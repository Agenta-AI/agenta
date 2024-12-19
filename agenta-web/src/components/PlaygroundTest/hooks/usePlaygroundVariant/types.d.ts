import {type UsePlaygroundVariantsOptions} from "../usePlaygroundVariants"
import type {StateVariant} from "../../state/types"

export interface UsePlaygroundVariantOptions extends NonNullable<UsePlaygroundVariantsOptions> {
    variantId: string
}

export interface UsePlaygroundVariantReturn {
    variant?: StateVariant
    isDirty?: boolean
    deleteVariant: () => Promise<void>
    mutateVariant: (updates: Partial<StateVariant>) => Promise<void>
}
