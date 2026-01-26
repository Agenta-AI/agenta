/**
 * Entity Transform Utilities
 *
 * Provides date normalization transforms for entity molecules.
 * Uses dayjs with customParseFormat plugin for WebKit compatibility.
 */

import dayjs from "./dayjs"

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
 */
function createTimestampNormalizer<T extends TimestampFields>(
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

// ============================================================================
// DATE PARSING
// ============================================================================

/**
 * Fallback date formats to try when parsing dates.
 * These cover common API response formats.
 */
const FALLBACK_FORMATS = [
    "YYYY-MM-DDTHH:mm:ss.SSSSSSZ", // Python datetime with microseconds
    "YYYY-MM-DDTHH:mm:ss.SSSZ", // ISO 8601 with milliseconds
    "YYYY-MM-DDTHH:mm:ssZ", // ISO 8601
    "YYYY-MM-DDTHH:mm:ss.SSSSSS", // Python datetime without TZ
    "YYYY-MM-DDTHH:mm:ss.SSS", // ISO without TZ
    "YYYY-MM-DDTHH:mm:ss", // Basic ISO
    "YYYY-MM-DD HH:mm:ss.SSSZ", // Space separator
    "YYYY-MM-DD HH:mm:ssZ",
    "YYYY-MM-DD HH:mm:ss",
]

/**
 * Parses a date string with WebKit-compatible fallback formats.
 *
 * @param date - Date string, Date object, null, or undefined
 * @returns Parsed Date object or null if invalid
 */
export function parseEntityDate(date: string | Date | null | undefined): Date | null {
    if (!date) return null

    if (date instanceof Date) {
        return isNaN(date.getTime()) ? null : date
    }

    // Try direct parsing first (handles most ISO formats)
    const direct = dayjs(date)
    if (direct.isValid()) {
        return direct.toDate()
    }

    // Try fallback formats for edge cases (especially WebKit)
    for (const format of FALLBACK_FORMATS) {
        const parsed = dayjs(date, format)
        if (parsed.isValid()) {
            return parsed.toDate()
        }
    }

    return null
}

// ============================================================================
// EXPORTS
// ============================================================================

/**
 * Normalizes created_at and updated_at fields in entity data.
 * Uses dayjs with customParseFormat for WebKit browser compatibility.
 *
 * @example
 * ```typescript
 * import { normalizeTimestamps } from '@agenta/shared/utils'
 *
 * export const testcaseMolecule = createMolecule({
 *   name: 'testcase',
 *   transform: normalizeTimestamps,
 *   // ...
 * })
 * ```
 */
export const normalizeTimestamps = createTimestampNormalizer(parseEntityDate)

/**
 * Type-safe normalizer for entities with timestamp fields.
 * Use this when you need explicit typing.
 */
export function normalizeEntityTimestamps<T extends TimestampFields>(data: T): T {
    return normalizeTimestamps(data) as T
}
