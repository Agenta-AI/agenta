import type {MouseEvent} from "react"
import type {StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
export interface UsePlaygroundVariantsReturn {
    variants: StateVariant[]
    addVariant: (event: MouseEvent, variant?: StateVariant) => void
}

export interface UsePlaygroundVariantsOptions extends Omit<UsePlaygroundStateOptions, "selector"> {}
