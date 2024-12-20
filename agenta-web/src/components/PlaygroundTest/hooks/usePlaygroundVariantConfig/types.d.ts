import type {StateVariant} from "../../state/types"
import type {Path} from "../../types/pathHelpers"
import type {InferSchemaType} from "../../types/shared"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"

// Define ConfigValue type based on the possible configuration values
export type ConfigValue = string | boolean | string[] | number | null

// Get the type for a specific key in the variant
export type VariantValueType<V extends StateVariant, K extends string> = PathValue<V, K>

export interface UsePlaygroundVariantConfigOptions
    extends Omit<UsePlaygroundStateOptions, "selector"> {
    configKey: Path<StateVariant> // Update this type
    valueKey: Path<StateVariant> // Update this type
    variantId: string
}

export interface PropertyConfig<
    V extends StateVariant,
    CK extends Path<V> & string,
    VK extends Path<V> & string,
    S extends SchemaObject | undefined = SchemaObject | undefined,
> {
    config: S
    valueInfo: InferSchemaType<S>
    handleChange: (e: {target: {value: ConfigValue}} | ConfigValue) => void
}

// export interface UsePlaygroundVariantConfigReturn<
//     V extends StateVariant,
//     CK extends Path<V> & string,
//     VK extends Path<V> & string,
//     S extends SchemaObject | undefined = SchemaObject | undefined,
// > {
//     config: S
//     value: InferSchemaType<S>
//     property: PropertyConfig<V, CK, VK, S>
// }

export interface UsePlaygroundVariantConfigReturn {
    config: SchemaObject
    valueInfo: unknown
    handleChange: (e: {target: {value: ConfigValue}} | ConfigValue) => void
}
