/**
 * Pluralization Utility
 *
 * Simple utility for pluralizing words based on count.
 *
 * @example
 * ```typescript
 * import { pluralize } from '@agenta/shared'
 *
 * pluralize(1, "testcase") // "testcase"
 * pluralize(5, "testcase") // "testcases"
 * pluralize(1, "child", "children") // "child"
 * pluralize(3, "child", "children") // "children"
 * ```
 */

/**
 * Returns singular or plural form based on count
 *
 * @param count - The number to check
 * @param singular - The singular form of the word
 * @param plural - Optional custom plural form (defaults to singular + "s")
 * @returns The appropriate form of the word
 */
export function pluralize(count: number, singular: string, plural?: string): string {
    return count === 1 ? singular : (plural ?? `${singular}s`)
}

/**
 * Returns a formatted string with count and pluralized word
 *
 * @param count - The number to display
 * @param singular - The singular form of the word
 * @param plural - Optional custom plural form (defaults to singular + "s")
 * @returns Formatted string like "5 items" or "1 item"
 *
 * @example
 * ```typescript
 * formatCount(1, "testcase") // "1 testcase"
 * formatCount(5, "testcase") // "5 testcases"
 * formatCount(0, "item") // "0 items"
 * ```
 */
export function formatCount(count: number, singular: string, plural?: string): string {
    return `${count} ${pluralize(count, singular, plural)}`
}
