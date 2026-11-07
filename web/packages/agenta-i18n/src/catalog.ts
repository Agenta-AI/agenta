import {useMemo, useState} from "react"

import {getDefaultStore, useAtomValue} from "jotai"

import {activeLanguageAtom, DEFAULT_LANGUAGE, getActiveLanguage, languageAtom} from "./language"
import {
    catalogVersionAtom,
    loadCatalog,
    loadCatalogs,
    registeredCount,
    registeredSince,
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

/**
 * Declares one small catalog. Its English is a static import, so it ships in the same chunk as
 * the screen that uses it and renders on the first paint. The other languages load with
 * `import()` when the screen's code loads, and only for the language the user chose.
 */
export const defineCatalog = <NS extends string, EN extends Catalog>(
    namespace: NS,
    en: EN,
    load: CatalogEntry["load"],
): TypedCatalog<`${NS}.${BaseKey<keyof EN & string>}`> => {
    const entry: CatalogEntry = {namespace, en, load}
    registerCatalog(entry)
    const language = getDefaultStore().get(languageAtom)
    if (language !== DEFAULT_LANGUAGE) void loadCatalog(entry, language).catch(() => undefined)
    return entry
}

type Translator<C extends CatalogEntry[]> = (
    key: CatalogKey<C[number]>,
    values?: TranslationValues,
) => string

/**
 * Loads a lazy module, then waits for its own catalogs in the chosen language, so a panel's text
 * arrives with its code. Never fails or hangs on a catalog: English shows after a failure or
 * the timeout. `lazy(() => loadWithText(() => import("./Panel")).then((m) => ({default: m.Panel})))`
 */
export const loadWithText = async <M>(load: () => Promise<M>): Promise<M> => {
    const before = registeredCount()
    const module = await load()
    await loadCatalogs(registeredSince(before), getDefaultStore().get(languageAtom))
    return module
}

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
