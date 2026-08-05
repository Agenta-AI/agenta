/**
 * Enhanced value pattern types.
 *
 * The enhanced pattern wraps values with metadata:
 * - `__id`: Unique identifier for the instance
 * - `__metadata`: Hash pointing to ConfigMetadata in the metadata store (or inline ConfigMetadata)
 * - `value`: The actual value (for primitives/arrays)
 */

// ============================================================================
// METADATA TYPES
// ============================================================================

export interface BaseOption {
    label: string
    value: string
    group?: string
    metadata?: Record<string, unknown>
}

export interface OptionGroup {
    label: string
    options: BaseOption[]
}

export type SelectOptions = (BaseOption | OptionGroup)[]

export interface BaseMetadata {
    type: string
    title?: string
    description?: string
    nullable?: boolean
    key?: string
    options?: SelectOptions
    min?: number
    max?: number
    format?: string
    pattern?: string
    isInteger?: boolean
}

export interface StringMetadata extends BaseMetadata {
    type: "string"
    allowFreeform?: boolean
}

export interface NumberMetadata extends BaseMetadata {
    type: "number"
    min?: number
    max?: number
    isInteger?: boolean
}

export interface BooleanMetadata extends BaseMetadata {
    type: "boolean"
}

export interface ArrayMetadata extends BaseMetadata {
    type: "array"
    itemMetadata?: ConfigMetadata
    minItems?: number
    maxItems?: number
}

export interface ObjectMetadata extends BaseMetadata {
    type: "object"
    properties?: Record<string, ConfigMetadata>
    additionalProperties?: boolean
}

export type ConfigMetadata =
    | StringMetadata
    | NumberMetadata
    | BooleanMetadata
    | ArrayMetadata
    | ObjectMetadata
    | BaseMetadata

export type Merge<A, B> = {
    [K in keyof A | keyof B]: K extends keyof A
        ? K extends keyof B
            ? A[K] | B[K]
            : A[K]
        : K extends keyof B
          ? B[K]
          : never
} & Common // Ensure that Common's properties are always included

export interface Common<T extends ConfigMetadata = ConfigMetadata> {
    __id: string
    __metadata: T | string
    __name?: string
}

/** Enhanced primitive value with metadata */
export interface EnhancedConfigValue<T> extends Common {
    value: T
}

/** Enhanced array structure */
export interface EnhancedArrayValue<T> {
    value: Enhanced<T>[]
    __id: string
    __metadata: ArrayMetadata
}

/** Utility type to check if a string starts with __ */
export type StartsWith__<T extends string | number | symbol> = T extends `__${string}`
    ? true
    : false

/** Conditional type to enhance or not enhance based on property key */
type EnhanceOrNot<K extends string | number | symbol, T> =
    StartsWith__<K> extends true ? T : Enhanced<T>

/** Enhanced object configuration with special handling for __ prefixed keys */
export type EnhancedObjectConfig<T> = Common & {
    [K in keyof T]: EnhanceOrNot<K, T[K]>
}

/** Generic enhanced configuration type */
export type Enhanced<T> = T extends (infer U)[]
    ? EnhancedArrayValue<U>
    : T extends Record<string, unknown>
      ? EnhancedObjectConfig<T>
      : EnhancedConfigValue<T>
