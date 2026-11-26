const OPTIONS: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
}

const DEFAULT_FORMAT = new Intl.DateTimeFormat(undefined, OPTIONS)

/**
 * The date and time in a list cell, the way the classic app's tables show it:
 * "Nov 5, 2026, 7:32 PM" in an English locale. A dash when the value is missing or not a date.
 *
 * `locale` is for callers that must not follow the browser; lists leave it out.
 */
export const formatListDateTime = (
    value: string | number | Date | null | undefined,
    locale?: string,
): string => {
    if (value === null || value === undefined || value === "") return "—"
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
    if (Number.isNaN(time)) return "—"
    const format = locale ? new Intl.DateTimeFormat(locale, OPTIONS) : DEFAULT_FORMAT
    return format.format(time)
}
