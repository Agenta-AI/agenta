/**
 * Shared Transform Utilities
 *
 * Provides helpers for transforming entity data, particularly for
 * normalizing common fields like timestamps.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Common timestamp fields found in most entities
 */
export interface TimestampFields {
    created_at?: string | Date | null
    updated_at?: string | Date | null
}

/**
 * A date parser function that converts various date formats to a consistent output
 */
export type DateParser = (date: string | Date | null | undefined) => Date | string | null

// ============================================================================
// TRANSFORM FACTORIES
// ============================================================================

/**
 * Creates a timestamp normalizer using the provided date parser.
 *
 * This factory pattern allows the package to remain dependency-free
 * while consumers can inject their preferred date parsing library.
 *
 * @example
 * ```typescript
 * // In OSS layer with dayjs
 * import dayjs from '@/oss/lib/helpers/dateTimeHelper/dayjs'
 *
 * const parseDate = (date: string | Date | null | undefined) => {
 *   if (!date) return null
 *   const parsed = dayjs(date)
 *   return parsed.isValid() ? parsed.toDate() : null
 * }
 *
 * export const normalizeTimestamps = createTimestampNormalizer(parseDate)
 * ```
 */
export function createTimestampNormalizer<T extends TimestampFields>(
    parseDate: DateParser,
): (data: T) => T {
    return (data: T): T => {
        const result = {...data}

        if (data.created_at !== undefined) {
            result.created_at = parseDate(data.created_at) as T["created_at"]
        }

        if (data.updated_at !== undefined) {
            result.updated_at = parseDate(data.updated_at) as T["updated_at"]
        }

        return result
    }
}

/**
 * Creates a generic field transformer that applies a transform function
 * to specified fields.
 *
 * @example
 * ```typescript
 * const normalizeUserDates = createFieldTransformer(parseDate, [
 *   'created_at',
 *   'updated_at',
 *   'last_login',
 * ])
 * ```
 */
export function createFieldTransformer<T>(
    transform: (value: unknown) => unknown,
    fields: (keyof T)[],
): (data: T) => T {
    return (data: T): T => {
        const result = {...data}

        for (const field of fields) {
            if (data[field] !== undefined) {
                ;(result as Record<keyof T, unknown>)[field] = transform(data[field])
            }
        }

        return result
    }
}

// ============================================================================
// COMPOSE TRANSFORMS
// ============================================================================

/**
 * Composes multiple transform functions into a single transform.
 *
 * @example
 * ```typescript
 * const transform = composeTransforms(
 *   normalizeTimestamps,
 *   normalizeUserFields,
 *   sanitizeHtml,
 * )
 *
 * const molecule = createMolecule({
 *   name: 'user',
 *   transform,
 *   // ...
 * })
 * ```
 */
export function composeTransforms<T>(...transforms: ((data: T) => T)[]): (data: T) => T {
    return (data: T): T => {
        return transforms.reduce((acc, transform) => transform(acc), data)
    }
}

// ============================================================================
// BUILT-IN TRANSFORMS (NO EXTERNAL DEPS)
// ============================================================================

/**
 * A simple ISO date parser using native Date.
 * For better browser compatibility (especially WebKit), use dayjs with customParseFormat.
 *
 * @example
 * ```typescript
 * // Basic usage (may have issues in Safari with some formats)
 * const normalizeTimestamps = createTimestampNormalizer(parseISODate)
 * ```
 */
export function parseISODate(date: string | Date | null | undefined): Date | null {
    if (!date) return null
    if (date instanceof Date) return isNaN(date.getTime()) ? null : date

    const parsed = new Date(date)
    return isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Basic timestamp normalizer using native Date parsing.
 *
 * NOTE: For production use with WebKit browsers (Safari, iOS),
 * prefer creating a normalizer with dayjs + customParseFormat plugin.
 */
export const normalizeTimestampsBasic = createTimestampNormalizer(parseISODate)
