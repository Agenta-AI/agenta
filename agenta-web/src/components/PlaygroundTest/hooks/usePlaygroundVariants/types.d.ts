import type {MouseEvent} from "react"
import type {StateVariant, UsePlaygroundStateOptions} from "../../state/types"

export interface UsePlaygroundVariantsReturn {
    variants: StateVariant[]
    addVariant: (event: MouseEvent, variant?: StateVariant) => void
}

export interface UsePlaygroundVariantsOptions extends Omit<UsePlaygroundStateOptions, "selector"> {}
