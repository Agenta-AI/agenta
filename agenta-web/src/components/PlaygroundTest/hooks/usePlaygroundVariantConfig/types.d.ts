import type {StateVariant} from "../../state/types"
import type {UsePlaygroundStateOptions} from "../usePlaygroundState/types"

// Define ConfigValue type based on the possible configuration values
export type ConfigValue = string | boolean | string[] | number | null

// Get the type for a specific key in the variant
export type VariantValueType<V extends StateVariant, K extends string> = PathValue<V, K>

// Improve schema type inference
export type InferSchemaType<T extends SchemaObject | undefined> = T extends SchemaObject
    ? T["type"] extends "string"
        ? T["enum"] extends Array<string>
            ? T["enum"][number]
            : string
        : T["type"] extends "number"
          ? number
          : T["type"] extends "integer"
            ? number
            : T["type"] extends "boolean"
              ? boolean
              : T["type"] extends "array"
                ? T["items"] extends SchemaObject
                    ? Array<InferSchemaType<T["items"]>>
                    : Array<unknown>
                : T["type"] extends "object"
                  ? T["properties"] extends Record<string, SchemaObject>
                      ? {[K in keyof T["properties"]]: InferSchemaType<T["properties"][K]>}
                      : Record<string, unknown>
                  : unknown
    : undefined

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

export interface UsePlaygroundVariantConfigReturn<
    V extends StateVariant,
    CK extends Path<V> & string,
    VK extends Path<V> & string,
    S extends SchemaObject | undefined = SchemaObject | undefined,
> {
    config: S
    value: InferSchemaType<S>
    property: PropertyConfig<V, CK, VK, S>
}
