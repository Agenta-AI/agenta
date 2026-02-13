/**
 * Formatting Utilities
 *
 * A comprehensive set of number formatting utilities for displaying values
 * in the UI. Provides both preset formatters for common use cases and a
 * flexible factory for custom formatting needs.
 *
 * @example
 * ```typescript
 * import {
 *   formatNumber,
 *   formatCurrency,
 *   formatLatency,
 *   formatSignificant,
 *   createFormatter,
 * } from '@agenta/shared'
 *
 * // Preset formatters
 * formatNumber(1234.567)      // "1,234.57"
 * formatCurrency(0.00123)     // "$0.001230"
 * formatLatency(0.5)          // "500ms"
 * formatSignificant(0.00456)  // "0.00456"
 *
 * // Custom formatter
 * const formatScore = createFormatter({ suffix: '%', decimals: 1 })
 * formatScore(0.856)          // "85.6%"
 * ```
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Configuration options for creating custom formatters
 */
export interface FormatterOptions {
    /** Number of decimal places (default: 2) */
    decimals?: number
    /** Use significant figures instead of fixed decimals */
    significantFigures?: number
    /** Prefix to prepend (e.g., "$") */
    prefix?: string
    /** Suffix to append (e.g., "%", "ms") */
    suffix?: string
    /** Multiplier to apply before formatting (e.g., 100 for percentages) */
    multiplier?: number
    /** Fallback string for null/undefined/NaN values (default: "-") */
    fallback?: string
    /** Use compact notation (1K, 1M) */
    compact?: boolean
    /** Use locale-aware formatting */
    locale?: boolean
}

/**
 * A formatter function that converts a number to a formatted string
 */
export type Formatter = (value: number | string | undefined | null) => string

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/** Cached Intl formatters for performance */
const intlNumber = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2})
const intlCompactNumber = new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 1,
})
const intlCurrency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
})

/**
 * Safely handles null, undefined, and NaN values
 */
const withFallback = <T, R extends string>(
    value: T | undefined | null,
    callback: (v: T) => R,
    fallback: R = "-" as R,
): R => {
    if (value == null || (typeof value === "number" && isNaN(value))) {
        return fallback
    }
    return callback(value)
}

/**
 * Converts a value to a number, returning null if not possible
 */
const toNumber = (value: number | string | undefined | null): number | null => {
    if (value == null) return null
    if (typeof value === "number") return isNaN(value) ? null : value
    const parsed = Number(value)
    return isNaN(parsed) ? null : parsed
}

// ============================================================================
// CORE FORMATTERS
// ============================================================================

/**
 * Formats a number with 3 significant figures.
 * Uses scientific notation for very large or very small numbers.
 *
 * @param value - Number or string to format
 * @returns Formatted string with 3 significant figures
 *
 * @example
 * ```typescript
 * formatSignificant(1234)      // "1230"
 * formatSignificant(0.00456)   // "0.00456"
 * formatSignificant(1.5e12)    // "1.50e+12"
 * formatSignificant(0)         // "0"
 * ```
 */
export const formatSignificant = (value: number | string | undefined | null): string => {
    const num = toNumber(value)
    if (num === null) return "-"
    if (!Number.isFinite(num)) return String(num)

    const abs = Math.abs(num)
    if (abs === 0) return "0"

    const exponent = Math.floor(Math.log10(abs))

    // Use scientific notation for extreme values
    if (exponent >= 10 || exponent <= -10) {
        return num.toExponential(2)
    }

    // Fixed-point with 3 significant digits
    const decimals = Math.max(0, 2 - exponent)
    const fixed = num.toFixed(decimals)

    // Strip trailing zeros and decimal point
    return fixed.replace(/\.?0+$/, "")
}

/**
 * Formats a number with locale-aware thousand separators and 2 decimal places.
 *
 * @example
 * ```typescript
 * formatNumber(1234.567)  // "1,234.57"
 * formatNumber(null)      // "-"
 * ```
 */
export const formatNumber = (value: number | undefined | null): string => {
    return withFallback(value, intlNumber.format)
}

/**
 * Formats a number in compact notation (1K, 1M, 1B).
 *
 * @example
 * ```typescript
 * formatCompact(1234)      // "1.2K"
 * formatCompact(1500000)   // "1.5M"
 * ```
 */
export const formatCompact = (value: number | undefined | null): string => {
    return withFallback(value, intlCompactNumber.format)
}

/**
 * Formats a number as USD currency with up to 6 decimal places.
 *
 * @example
 * ```typescript
 * formatCurrency(1234.56)   // "$1,234.56"
 * formatCurrency(0.00123)   // "$0.001230"
 * ```
 */
export const formatCurrency = (value: number | undefined | null): string => {
    return withFallback(value, intlCurrency.format)
}

/**
 * Formats a duration in seconds to human-readable latency.
 * Automatically selects appropriate unit (μs, ms, s).
 *
 * @param value - Duration in seconds
 * @returns Formatted latency string
 *
 * @example
 * ```typescript
 * formatLatency(0.0001)   // "100μs"
 * formatLatency(0.5)      // "500ms"
 * formatLatency(2.5)      // "2.5s"
 * ```
 */
export const formatLatency = (value: number | undefined | null): string => {
    return withFallback(value, (v) => {
        const MS_LIMIT = 1000
        const S_LIMIT = MS_LIMIT * 1000
        const S_TO_US = S_LIMIT

        let resultValue = v * S_TO_US
        let unit = "μs"

        if (MS_LIMIT < resultValue && resultValue < S_LIMIT) {
            resultValue = Math.round(resultValue / MS_LIMIT)
            unit = "ms"
        } else if (S_LIMIT <= resultValue) {
            resultValue = Math.round((resultValue / S_LIMIT) * 100) / 100
            unit = "s"
        } else {
            resultValue = Math.round(resultValue)
        }

        return `${resultValue}${unit}`
    })
}

/**
 * Formats token counts with compact notation for large numbers.
 *
 * @example
 * ```typescript
 * formatTokens(500)       // "500"
 * formatTokens(1500)      // "1.5K"
 * formatTokens(1500000)   // "1.5M"
 * ```
 */
export const formatTokens = (value: number | undefined | null): string => {
    return withFallback(value, (v) => {
        if (v < 1000) return Math.round(v).toLocaleString()
        if (v < 1_000_000) return `${(v / 1000).toFixed(1)}K`
        return `${(v / 1_000_000).toFixed(1)}M`
    })
}

/**
 * Formats a decimal as a percentage.
 *
 * @param value - Decimal value (0.5 = 50%)
 * @returns Formatted percentage string
 *
 * @remarks
 * - Negative values are treated as 0% (use case: scores/metrics that shouldn't be negative)
 * - Values >= 99.95% are rounded to "100%"
 * - Values >= 10% show 1 decimal place
 * - Values < 10% show 2 decimal places
 *
 * @example
 * ```typescript
 * formatPercent(0.856)    // "85.6%"
 * formatPercent(1)        // "100%"
 * formatPercent(0.001)    // "0.10%"
 * formatPercent(-0.1)     // "0%" (negative values treated as 0)
 * ```
 */
export const formatPercent = (value: number | undefined | null): string => {
    return withFallback(value, (v) => {
        const percent = v * 100
        if (!Number.isFinite(percent) || percent <= 0) return "0%"
        if (percent >= 99.95) return "100%"
        if (percent >= 10) return `${percent.toFixed(1)}%`
        return `${percent.toFixed(2)}%`
    })
}

// ============================================================================
// FORMATTER FACTORY
// ============================================================================

/**
 * Creates a custom formatter function with the specified options.
 *
 * @param options - Formatting configuration
 * @returns A formatter function
 *
 * @example
 * ```typescript
 * // Score formatter (0-1 to percentage)
 * const formatScore = createFormatter({
 *   multiplier: 100,
 *   suffix: '%',
 *   decimals: 1,
 * })
 * formatScore(0.856)  // "85.6%"
 *
 * // Cost formatter
 * const formatCost = createFormatter({
 *   prefix: '$',
 *   decimals: 4,
 * })
 * formatCost(0.0123)  // "$0.0123"
 *
 * // Duration in ms
 * const formatMs = createFormatter({
 *   multiplier: 1000,
 *   suffix: 'ms',
 *   decimals: 0,
 * })
 * formatMs(0.5)  // "500ms"
 * ```
 */
export const createFormatter = (options: FormatterOptions = {}): Formatter => {
    const {
        decimals = 2,
        significantFigures,
        prefix = "",
        suffix = "",
        multiplier = 1,
        fallback = "-",
        compact = false,
        locale = false,
    } = options

    return (value: number | string | undefined | null): string => {
        const num = toNumber(value)
        if (num === null) return fallback

        const adjusted = num * multiplier

        let formatted: string
        if (significantFigures) {
            // Use significant figures formatting
            formatted = formatSignificant(adjusted)
        } else if (compact) {
            // Use compact notation
            formatted = formatCompact(adjusted)
        } else if (locale) {
            // Use locale-aware formatting
            formatted = adjusted.toLocaleString("en-US", {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
            })
        } else {
            // Simple fixed decimal formatting
            formatted = adjusted.toFixed(decimals)
        }

        return `${prefix}${formatted}${suffix}`
    }
}

// ============================================================================
// VALUE PREVIEW FORMATTERS
// ============================================================================

/**
 * Formats an unknown value for display preview.
 * Truncates long strings and provides type-aware formatting for objects/arrays.
 *
 * @param value - Any value to format for preview
 * @param maxLength - Maximum length for string values (default: 50)
 * @returns Formatted preview string
 *
 * @example
 * ```typescript
 * formatPreviewValue("hello")                    // '"hello"'
 * formatPreviewValue("very long string...", 10) // '"very long..."'
 * formatPreviewValue(123)                        // "123"
 * formatPreviewValue(true)                       // "true"
 * formatPreviewValue([1, 2, 3])                  // "[Array(3)]"
 * formatPreviewValue({a: 1, b: 2})               // "{a, b}"
 * formatPreviewValue(null)                       // "(null)"
 * formatPreviewValue(undefined)                  // "(undefined)"
 * ```
 */
export const formatPreviewValue = (value: unknown, maxLength = 50): string => {
    if (value === undefined) return "(undefined)"
    if (value === null) return "(null)"
    if (typeof value === "string") {
        if (value.length > maxLength) {
            return `"${value.slice(0, maxLength)}..."`
        }
        return `"${value}"`
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value)
    }
    if (Array.isArray(value)) {
        return `[Array(${value.length})]`
    }
    if (typeof value === "object") {
        const keys = Object.keys(value)
        if (keys.length <= 3) {
            return `{${keys.join(", ")}}`
        }
        return `{${keys.slice(0, 3).join(", ")}...}`
    }
    return String(value)
}

// ============================================================================
// LEGACY ALIASES (for backward compatibility)
// ============================================================================

/** @deprecated Use formatCompact instead */
export const formatCompactNumber = formatCompact

/** @deprecated Use formatTokens instead */
export const formatTokenUsage = formatTokens
