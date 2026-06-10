/**
 * Generic type helpers for converting snake_case object keys to camelCase.
 *
 * These are pure type-level utilities (no runtime code). They mirror the
 * casing convention used between the Agenta backend (snake_case payloads) and
 * the front-end (camelCase view models).
 */

/** Convert a snake_case string literal type to camelCase. */
export type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
    ? `${T}${Capitalize<SnakeToCamelCase<U>>}`
    : S

/** Recursively convert all snake_case object keys to camelCase. */
export type SnakeToCamelCaseKeys<T> = T extends readonly unknown[]
    ? T extends [infer First, ...infer Rest]
        ? [SnakeToCamelCaseKeys<First>, ...SnakeToCamelCaseKeys<Rest>]
        : T extends (infer U)[]
          ? SnakeToCamelCaseKeys<U>[]
          : T
    : T extends object
      ? {
            [K in keyof T as SnakeToCamelCase<K & string>]: SnakeToCamelCaseKeys<T[K]>
        }
      : T
