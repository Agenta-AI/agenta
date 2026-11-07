import {useEffect} from "react"

import {atom, getDefaultStore, useAtom, useAtomValue} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {loadLanguage} from "./registry"

export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "ja-JP"] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = "en"

/** The `<html lang>` value of each language. */
export const HTML_LANG: Record<Language, string> = {en: "en", "zh-CN": "zh-CN", "ja-JP": "ja"}

/** Cookie, not localStorage, so a server can render `<html lang>` too. */
export const LANGUAGE_COOKIE = "agenta-language"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Set on `<html>` by {@link languageInitScript} while a non-English catalog loads. */
export const LANGUAGE_PENDING_ATTRIBUTE = "data-i18n-pending"

export const isLanguage = (value: unknown): value is Language =>
    SUPPORTED_LANGUAGES.includes(value as Language)

export const readLanguageCookie = (cookie?: string): Language => {
    const source = cookie ?? (typeof document === "undefined" ? "" : document.cookie)
    const match = source.match(/(?:^|;\s*)agenta-language=([^;]*)/)
    const value = match ? decodeURIComponent(match[1]) : null
    return isLanguage(value) ? value : DEFAULT_LANGUAGE
}

const writeLanguageCookie = (language: Language) => {
    document.cookie = `${LANGUAGE_COOKIE}=${encodeURIComponent(language)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
}

/**
 * The browser's preferred supported language. Not called yet: it turns on only when every
 * screen is translated.
 */
export const detectBrowserLanguage = (
    languages: readonly string[] = typeof navigator === "undefined" ? [] : navigator.languages,
): Language => {
    for (const tag of languages) {
        const lower = tag.toLowerCase()
        if (lower === "en" || lower.startsWith("en-")) return "en"
        if (/^zh(-cn|-sg|-hans.*)?$/.test(lower)) return "zh-CN"
        if (lower === "ja" || lower.startsWith("ja-")) return "ja-JP"
    }
    return DEFAULT_LANGUAGE
}

/** The user's chosen language, as stored in the cookie. */
export const languageAtom = atomWithStorage<Language>(
    LANGUAGE_COOKIE,
    DEFAULT_LANGUAGE,
    {
        getItem: () => readLanguageCookie(),
        setItem: (_key, value) => writeLanguageCookie(value),
        removeItem: () => writeLanguageCookie(DEFAULT_LANGUAGE),
    },
    // Text renders from activeLanguageAtom, so reading the cookie early cannot break hydration.
    {getOnInit: true},
)

/** The language whose catalogs are loaded and rendered. Stays English until a load finishes. */
export const activeLanguageAtom = atom<Language>(DEFAULT_LANGUAGE)

/** The rendered language, read from the default store that the app's `Provider` uses. */
export const getActiveLanguage = (): Language => getDefaultStore().get(activeLanguageAtom)

const reveal = () => document.documentElement.removeAttribute(LANGUAGE_PENDING_ATTRIBUTE)

/**
 * Mount once at the app root. Loads the chosen language after hydration, then sets
 * `<html lang>` and shows the page that {@link languageInitScript} hid.
 */
export const useLanguageSync = () => {
    const language = useAtomValue(languageAtom)
    const [active, setActive] = useAtom(activeLanguageAtom)

    useEffect(() => {
        let cancelled = false
        // Set only after the cancel check, so a superseded load never wins.
        loadLanguage(language).then(
            () => !cancelled && setActive(language),
            () => !cancelled && reveal(),
        )
        return () => {
            cancelled = true
        }
    }, [language, setActive])

    useEffect(() => {
        document.documentElement.lang = HTML_LANG[active]
        if (active === language) reveal()
    }, [active, language])
}
