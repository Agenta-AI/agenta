import {atom, getDefaultStore} from "jotai"

import type {Language} from "./language"

export type Catalog = Record<string, string>
export type TranslatedLanguage = Exclude<Language, "en">
/** Loads one language file of a catalog; it rejects when the file does not exist. */
export type CatalogLoader = (language: TranslatedLanguage) => Promise<{default: Catalog}>

/** One small catalog: its namespace, its English (bundled with the screen), other loaders. */
export interface CatalogEntry {
    namespace: string
    en: Catalog
    load: CatalogLoader
}

interface LanguageModule {
    loadNamespace: (namespace: string) => Promise<{default: Catalog}>
}

/**
 * One loader module per language. A catalog carries only its namespace, not a loader of its own,
 * so a page does not ship a map of every language file of every catalog it uses.
 */
const LANGUAGE_MODULES: Record<TranslatedLanguage, () => Promise<LanguageModule>> = {
    "zh-CN": () => import("./languages/zh-CN"),
    "ja-JP": () => import("./languages/ja-JP"),
    "es-ES": () => import("./languages/es-ES"),
    "pt-BR": () => import("./languages/pt-BR"),
    "de-DE": () => import("./languages/de-DE"),
    "fr-FR": () => import("./languages/fr-FR"),
}

/** The loader of a catalog file in `locales/<language>/<namespace>.json`. */
export const namespaceLoader =
    (namespace: string): CatalogLoader =>
    (language) =>
        LANGUAGE_MODULES[language]().then((module) => module.loadNamespace(namespace))

const registered: CatalogEntry[] = []
const loaded = new Map<string, Catalog>()
const pending = new Map<string, Promise<void>>()

/** The one wait for a catalog: after it a load counts as failed and its English shows. */
export const CATALOG_TIMEOUT_MS = 3000

/** Bumped when a catalog loads, fails or times out, so `useT` re-renders with the new text. */
export const catalogVersionAtom = atom(0)

const bump = () => {
    const store = getDefaultStore()
    store.set(catalogVersionAtom, store.get(catalogVersionAtom) + 1)
}

export const registerCatalog = (entry: CatalogEntry) => registered.push(entry)

/** How many catalogs are registered; `registeredSince` returns the ones added after it. */
export const registeredCount = () => registered.length
export const registeredSince = (count: number) => registered.slice(count)

export const getLoadedCatalog = (language: Language, namespace: string): Catalog | undefined =>
    loaded.get(`${language}:${namespace}`)

/**
 * Rejects if the catalog cannot load within `CATALOG_TIMEOUT_MS`; it then shows English, and a
 * later call retries. A load that finishes after the timeout is still used.
 */
export const loadCatalog = (entry: CatalogEntry, language: Language): Promise<void> => {
    if (language === "en") return Promise.resolve()
    const id = `${language}:${entry.namespace}`
    if (loaded.has(id)) return Promise.resolve()
    let promise = pending.get(id)
    if (!promise) {
        const load = entry.load(language).then((module) => {
            loaded.set(id, module.default)
            bump()
        })
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("catalog timed out")), CATALOG_TIMEOUT_MS)
        })
        promise = Promise.race([load, timeout]).finally(() => {
            clearTimeout(timer)
            pending.delete(id)
            bump()
        })
        pending.set(id, promise)
    }
    return promise
}

/** Loads the language for the given catalogs; never rejects. */
export const loadCatalogs = async (entries: readonly CatalogEntry[], language: Language) => {
    if (language === "en") return
    await Promise.allSettled(entries.map((entry) => loadCatalog(entry, language)))
}

/** Loads the language for every catalog the page has imported so far. */
export const loadLanguage = (language: Language): Promise<void> =>
    loadCatalogs(registered, language)
