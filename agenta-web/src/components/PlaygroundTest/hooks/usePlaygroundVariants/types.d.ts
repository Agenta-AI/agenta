import type {MouseEvent} from "react"
import type {StateVariant, InitialStateType} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"
import type {KeyedMutator} from "swr"

export interface UsePlaygroundVariantsReturn {
    variants: StateVariant[]
    addVariant: (options: {baseVariantName: string; newVariantName: string}) => void
    mutate: KeyedMutator<InitialStateType>
    projectId: string
}

export interface UsePlaygroundVariantsOptions
    extends Omit<UsePlaygroundStateOptions, "selector" | "projectId"> {}
