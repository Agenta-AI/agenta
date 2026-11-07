import {useMemo, useState} from "react"

import {getDefaultStore, useAtomValue} from "jotai"

import {
    activeLanguageAtom,
    DEFAULT_LANGUAGE,
    getActiveLanguage,
    languageAtom,
    type Language,
} from "./language"
import {
    catalogVersionAtom,
    loadCatalog,
    registerCatalog,
    type Catalog,
    type CatalogEntry,
} from "./registry"
import {translate, type TranslationValues} from "./translate"

type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other"
type BaseKey<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : K

declare const keyType: unique symbol

/** A catalog entry that also carries its keys as a type: `"<namespace>.<key>"`. */
export interface TypedCatalog<K extends string> extends CatalogEntry {
    readonly [keyType]?: K
}

export type CatalogKey<C> = C extends TypedCatalog<infer K> ? K : never

type Loaders = Record<Language, () => Promise<{default: Catalog}>>
type EnglishOf<L extends Loaders> = Awaited<ReturnType<L["en"]>>["default"]

/**
 * Declares one small catalog. Every language, English included, loads with
 * `import()` when the catalog's module is first evaluated, so a page's JavaScript carries only
 * keys. `t` returns "" until the English arrives (pages render after auth, so this is unseen).
 */
export const defineCatalog = <NS extends string, L extends Loaders>(
    namespace: NS,
    load: L,
): TypedCatalog<`${NS}.${BaseKey<keyof EnglishOf<L> & string>}`> => {
    const entry: CatalogEntry = {namespace, load}
    registerCatalog(entry)
    void loadCatalog(entry, DEFAULT_LANGUAGE).catch(() => undefined)
    const language = getDefaultStore().get(languageAtom)
    if (language !== DEFAULT_LANGUAGE) void loadCatalog(entry, language).catch(() => undefined)
    return entry
}

type Translator<C extends CatalogEntry[]> = (
    key: CatalogKey<C[number]>,
    values?: TranslationValues,
) => string

/** A `t` outside React: reads the active language when called and does not re-render. */
export const createT =
    <C extends CatalogEntry[]>(...catalogs: C): Translator<C> =>
    (key, values) =>
        translate(getActiveLanguage(), key, values, catalogs)

/** A `t` for components; it changes, and the component re-renders, when the language does. */
export const useT = <C extends CatalogEntry[]>(...catalogs: C): Translator<C> => {
    const [entries] = useState(catalogs)
    const language = useAtomValue(activeLanguageAtom)
    const version = useAtomValue(catalogVersionAtom)
    return useMemo<Translator<C>>(
        () => (key, values) => translate(language, key, values, entries, version),
        [entries, language, version],
    )
}
