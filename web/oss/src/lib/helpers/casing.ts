/**
 * Recursively converts all object keys from snake_case to camelCase.
 * Handles nested objects and arrays.
 *
 * @template T - The expected return type.
 * @param obj - The object to transform.
 * @returns A new object or array with all keys in camelCase.
 */

import type {SnakeToCamelCaseKeys} from "../Types"

/**
 * Recursively converts all object keys from snake_case to camelCase.
 * Handles nested objects and arrays.
 *
 * @template T - The expected input type (snake_case).
 * @param obj - The object to transform.
 * @returns A new object or array with all keys in camelCase, typed as SnakeToCamelCaseKeys<T>.
 */
export function snakeToCamelCaseKeys<T>(obj: T): SnakeToCamelCaseKeys<T> {
    if (Array.isArray(obj)) {
        return obj.map((item) => snakeToCamelCaseKeys(item)) as SnakeToCamelCaseKeys<T>
    } else if (obj !== null && typeof obj === "object") {
        return Object.entries(obj).reduce(
            (acc, [key, value]) => {
                const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
                acc[camelKey] = snakeToCamelCaseKeys(value)
                return acc
            },
            {} as Record<string, unknown>,
        ) as SnakeToCamelCaseKeys<T>
    }
    return obj as SnakeToCamelCaseKeys<T>
}
