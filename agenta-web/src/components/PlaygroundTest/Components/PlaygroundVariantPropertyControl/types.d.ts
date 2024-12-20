import type {StateVariant} from "../../state/types"
import type {Path} from "../../types/pathHelpers"
import type {SchemaObject} from "../../types/shared"

export interface PlaygroundVariantPropertyControlProps {
    configKey: Path<StateVariant>
    valueKey: Path<StateVariant>
    variantId: string
}

export type PropertyConfig = SchemaObject

export interface PropertyData {
    config: SchemaObject
    valueInfo: unknown
    handleChange: (e: {target: {value: ConfigValue}} | ConfigValue) => void
}
