import {parseEntityDate} from "@agenta/shared/utils"

export type EntityDateInput = string | number | Date | null | undefined

export interface EntityDateTimeFormatOptions {
    locale?: Intl.LocalesArgument
    fallback?: string
}

const DEFAULT_FALLBACK = ""

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function getFormatter(locale?: Intl.LocalesArgument): Intl.DateTimeFormat {
    const cacheKey =
        locale === undefined
            ? "__default__"
            : Array.isArray(locale)
              ? locale.join("|")
              : String(locale)

    const cached = formatterCache.get(cacheKey)
    if (cached) return cached

    const formatter = new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    })

    formatterCache.set(cacheKey, formatter)
    return formatter
}

function parseInput(value: EntityDateInput): Date | null {
    if (value == null) return null

    if (typeof value === "number") {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? null : date
    }

    return parseEntityDate(value)
}

/**
 * Format a date value in the canonical entity datetime format.
 *
 * Output shape: `DD MMM YYYY | h:mm a` (for example: `29 Jan 2026 | 2:01 pm`)
 */
export function formatEntityDateTime(
    value: EntityDateInput,
    options?: EntityDateTimeFormatOptions,
): string {
    const date = parseInput(value)
    if (!date) return options?.fallback ?? DEFAULT_FALLBACK

    const formatter = getFormatter(options?.locale)
    const parts = formatter.formatToParts(date)

    const day = parts.find((part) => part.type === "day")?.value
    const month = parts.find((part) => part.type === "month")?.value
    const year = parts.find((part) => part.type === "year")?.value
    const hour = parts.find((part) => part.type === "hour")?.value
    const minute = parts.find((part) => part.type === "minute")?.value
    const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value

    if (!day || !month || !year || !hour || !minute) {
        return formatter.format(date)
    }

    return dayPeriod
        ? `${day} ${month} ${year} | ${hour}:${minute} ${dayPeriod.toLowerCase()}`
        : `${day} ${month} ${year} | ${hour}:${minute}`
}
