import type {ConfigMetadata} from "./metadata"

type Merge<A, B> = {
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
    __metadata: T
}

/** Enhanced primitive value with metadata */
export interface EnhancedConfigValue<T> extends Common {
    value: T
}

/** Enhanced array structure */
export type EnhancedArrayValue<T> = {
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
    [K in keyof T]: EnhanceOrNot<K & string, T[K]>
}

/** Generic enhanced configuration type */
export type Enhanced<T> =
    T extends Array<infer U>
        ? EnhancedArrayValue<U>
        : T extends Record<string, any>
          ? EnhancedObjectConfig<T>
          : EnhancedConfigValue<T>
//    &
// Common
