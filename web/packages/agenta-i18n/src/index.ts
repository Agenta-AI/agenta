import {Fragment, createElement, type ReactNode} from "react"

import {getActiveLanguage} from "./language"

export {
    createT,
    defineCatalog,
    loadWithText,
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
// English keeps the browser locale, so dates and numbers read as they did before translation.
const formatLocale = () => {
    const language = getActiveLanguage()
    return language === "en" ? undefined : language
}

export const formatDate = (date: Date | number, options?: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(formatLocale(), options).format(date)

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
    new Intl.NumberFormat(formatLocale(), options).format(value)

/**
 * Renders `<name>text</name>` tags in translated text as elements, so a sentence with a link
 * stays one key: `richText(t("settings.x"), {link: (text) => <a href={url}>{text}</a>})`.
 */
export const richText = (
    text: string,
    elements: Record<string, (children: string) => ReactNode>,
): ReactNode[] =>
    text.split(/(<\w+>.*?<\/\w+>)/).map((part, index) => {
        const match = part.match(/^<(\w+)>(.*?)<\/\1>$/)
        const render = match && elements[match[1]]
        return createElement(Fragment, {key: index}, render ? render(match[2]) : part)
    })
