import {useEffect} from "react"

import {atom, useAtom, useAtomValue} from "jotai"
import {atomWithStorage} from "jotai/utils"

export const SUPPORTED_LANGUAGES = ["en", "zh-CN"] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const DEFAULT_LANGUAGE: Language = "en"

/** Cookie, not localStorage, so a server can render `<html lang>` too. */
export const LANGUAGE_COOKIE = "agenta-language"
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Set on `<html>` by {@link languageInitScript} while a non-English catalog loads. */
export const LANGUAGE_PENDING_ATTRIBUTE = "data-i18n-pending"

export type Catalog = Record<string, string>
export type Catalogs = Record<string, Catalog>

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

let activeLanguage: Language = DEFAULT_LANGUAGE
const loadedCatalogs: Partial<Record<Language, Catalogs>> = {}

export const getActiveLanguage = (): Language => activeLanguage
export const getLoadedCatalogs = (language: Language): Catalogs | undefined =>
    loadedCatalogs[language]

const CATALOG_LOADERS: Record<Exclude<Language, "en">, () => Promise<Catalogs>> = {
    "zh-CN": async () => {
        const [billing, channels, common, navigation, publish, settings] = await Promise.all([
            import("../locales/zh-CN/billing.json"),
            import("../locales/zh-CN/channels.json"),
            import("../locales/zh-CN/common.json"),
            import("../locales/zh-CN/navigation.json"),
            import("../locales/zh-CN/publish.json"),
            import("../locales/zh-CN/settings.json"),
        ])
        return {
            billing: billing.default,
            channels: channels.default,
            common: common.default,
            navigation: navigation.default,
            publish: publish.default,
            settings: settings.default,
        }
    },
}

/** Loads the language's catalogs (English is bundled) and makes it the one `t()` uses. */
export const activateLanguage = async (language: Language): Promise<void> => {
    if (language !== "en" && !loadedCatalogs[language]) {
        loadedCatalogs[language] = await CATALOG_LOADERS[language]()
    }
    activeLanguage = language
}

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
        activateLanguage(language).then(
            () => !cancelled && setActive(language),
            () => !cancelled && reveal(),
        )
        return () => {
            cancelled = true
        }
    }, [language, setActive])

    useEffect(() => {
        document.documentElement.lang = active
        if (active === language) reveal()
    }, [active, language])
}

/**
 * Inline `<head>` script for a statically rendered document: sets `<html lang>` from the
 * cookie before paint and hides the page until the catalog loads, so no English flashes.
 */
export const languageInitScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${LANGUAGE_COOKIE}=([^;]*)/);var l=m&&decodeURIComponent(m[1]);if(l&&l!=='en'&&${JSON.stringify(SUPPORTED_LANGUAGES)}.indexOf(l)>-1){var h=document.documentElement;h.lang=l;h.setAttribute('${LANGUAGE_PENDING_ATTRIBUTE}','');setTimeout(function(){h.removeAttribute('${LANGUAGE_PENDING_ATTRIBUTE}')},3000)}}catch(e){}})();`

/** Style that pairs with {@link languageInitScript}. */
export const languagePendingStyle = `html[${LANGUAGE_PENDING_ATTRIBUTE}] body{visibility:hidden}`
