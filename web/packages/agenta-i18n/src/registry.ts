import {atom, getDefaultStore} from "jotai"

import type {Language} from "./language"

export type Catalog = Record<string, string>
export type CatalogLoader = () => Promise<{default: Catalog}>

/** One small catalog: its namespace, its English (bundled with the screen), other loaders. */
export interface CatalogEntry {
    namespace: string
    en: Catalog
    load: Record<Exclude<Language, "en">, CatalogLoader>
}

const registered: CatalogEntry[] = []
const loaded = new Map<string, Catalog>()
const pending = new Map<string, Promise<void>>()
/** Catalogs still loading and still inside the timeout; they render "" rather than English. */
const waiting = new Set<string>()

/** After this long a catalog that is still loading shows English, so labels never stay blank. */
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

export const isCatalogLoading = (language: Language, namespace: string): boolean =>
    waiting.has(`${language}:${namespace}`)

/** Rejects if the catalog cannot load; the catalog then shows English, and a later call retries. */
export const loadCatalog = (entry: CatalogEntry, language: Language): Promise<void> => {
    if (language === "en") return Promise.resolve()
    const id = `${language}:${entry.namespace}`
    if (loaded.has(id)) return Promise.resolve()
    let promise = pending.get(id)
    if (!promise) {
        waiting.add(id)
        const timer = setTimeout(() => waiting.delete(id) && bump(), CATALOG_TIMEOUT_MS)
        promise = entry.load[language]()
            .then((module) => {
                loaded.set(id, module.default)
            })
            .finally(() => {
                clearTimeout(timer)
                waiting.delete(id)
                pending.delete(id)
                bump()
            })
        pending.set(id, promise)
    }
    return promise
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Loads the language for the given catalogs; never rejects and never waits past the timeout. */
export const loadCatalogs = async (entries: readonly CatalogEntry[], language: Language) => {
    if (language === "en" || entries.length === 0) return
    await Promise.race([
        Promise.allSettled(entries.map((entry) => loadCatalog(entry, language))),
        delay(CATALOG_TIMEOUT_MS),
    ])
}

/** Loads the language for every catalog the page has imported so far. */
export const loadLanguage = (language: Language): Promise<void> =>
    loadCatalogs(registered, language)
