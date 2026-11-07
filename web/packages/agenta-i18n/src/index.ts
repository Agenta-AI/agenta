import {Fragment, createElement, type ReactNode} from "react"

import {getActiveLanguage} from "./language"

export type {Namespace, TranslationKey} from "./catalogs"
export type {TranslationValues} from "./translate"
export {
    SUPPORTED_LANGUAGES,
    DEFAULT_LANGUAGE,
    activeLanguageAtom,
    getActiveLanguage,
    languageAtom,
    type Language,
} from "./language"

// `t` and `useT` come from each namespace's entry: `import {useT} from "@agenta/i18n/settings"`.
export const formatDate = (date: Date | number, options?: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(getActiveLanguage(), options).format(date)

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
    new Intl.NumberFormat(getActiveLanguage(), options).format(value)

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
