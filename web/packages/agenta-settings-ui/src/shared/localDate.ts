import {formatLocale} from "@agenta/i18n"

/**
 * A date in the chosen language. English keeps the caller's own format exactly as it was; other
 * languages use `Intl` with `options`, so month names and order follow the language.
 */
export const localDate = (
    date: Date,
    options: Intl.DateTimeFormatOptions,
    english: () => string,
): string => {
    const locale = formatLocale()
    return locale ? date.toLocaleString(locale, options) : english()
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
]

/** "5 minutes ago" in the chosen language; English keeps the caller's own text exactly. */
export const localFromNow = (date: Date, english: () => string): string => {
    const locale = formatLocale()
    if (!locale) return english()
    const seconds = Math.round((date.getTime() - Date.now()) / 1000)
    const [unit, size] =
        RELATIVE_UNITS.find(([, size]) => Math.abs(seconds) >= size) ?? RELATIVE_UNITS[5]
    return new Intl.RelativeTimeFormat(locale, {numeric: "auto"}).format(
        Math.round(seconds / size),
        unit,
    )
}
