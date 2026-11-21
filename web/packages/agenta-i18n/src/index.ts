import {Fragment, createElement, type ReactNode} from "react"

import {getActiveLanguage} from "./language"

export {
    createEnglishT,
    createT,
    defineCatalog,
    loadWithText,
    textVersionAtom,
    useT,
    type CatalogKey,
    type TypedCatalog,
} from "./catalog"
export type {TranslationValues} from "./translate"
export {
    HTML_LANG,
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
    activeLanguageAtom,
    getActiveLanguage,
    languageAtom,
    type Language,
} from "./language"

// Usage: `const t = useT(membersCatalog, commonCatalog)` in a component, with each catalog
// imported from `@agenta/i18n/catalogs/<namespace>`. Outside React, `createT(...)` at module
// level; a file that needs both names the module one `tNow`.
/**
 * The locale for `toLocale*String` and `Intl`: undefined in English, so English output stays the
 * browser locale exactly as before translation; the chosen language otherwise.
 */
export const formatLocale = (): string | undefined => {
    const language = getActiveLanguage()
    return language === "en" ? undefined : language
}

export const formatDate = (date: Date | number, options?: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(formatLocale(), options).format(date)

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
    new Intl.NumberFormat(formatLocale(), options).format(value)

/**
 * A relative time ("vor 5 Min.", "5分钟前") in the chosen language. Negative values are in the
 * past. Defaults to the short style: "narrow" drops the words in French ("-5 min").
 */
export const formatRelativeTime = (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options: Intl.RelativeTimeFormatOptions = {style: "short", numeric: "auto"},
): string => new Intl.RelativeTimeFormat(formatLocale(), options).format(value, unit)

/**
 * Renders `<name>text</name>` tags in translated text as elements, so a sentence with a link
 * stays one key: `richText(t("settings.x"), {link: (text) => <a href={url}>{text}</a>})`.
 */
export const richText = (
    text: string,
    elements: Record<string, (children: string) => ReactNode>,
): ReactNode[] => {
    const parts: ReactNode[] = []
    let last = 0
    for (const match of text.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) {
        const render = elements[match[1]]
        if (match.index > last)
            parts.push(createElement(Fragment, {key: last}, text.slice(last, match.index)))
        parts.push(
            createElement(Fragment, {key: match.index}, render ? render(match[2]) : match[0]),
        )
        last = match.index + match[0].length
    }
    if (last < text.length) parts.push(createElement(Fragment, {key: last}, text.slice(last)))
    return parts
}
