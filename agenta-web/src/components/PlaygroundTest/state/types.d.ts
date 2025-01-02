import {Variant} from "@/lib/Types"
import {SWRConfiguration, Key, Middleware} from "swr"
import type {BaseSchema, StringSchema, NumberSchema, BooleanSchema, WithConfig} from "./shared"
import {BaseVariant} from "../improvedTypes/stateVariant"
import {EnhancedVariant} from "../betterTypes/types"

// State Types
export interface InitialStateType {
    variants: EnhancedVariant[]
    selected?: EnhancedVariant
    addVariant?: (baseVariantName: string, newVariantName: string) => void
    deleteVariant?: () => void
    saveVariant?: () => void
    dirtyStates?: Map<string, boolean>
}
