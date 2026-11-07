import {atom, getDefaultStore} from "jotai"

import type {Language} from "./language"

export type Catalog = Record<string, string>
export type CatalogLoader = () => Promise<{default: Catalog}>

/** One small catalog: its namespace and a loader per language. Nothing is bundled up front. */
export interface CatalogEntry {
    namespace: string
    load: Record<Language, CatalogLoader>
}

const registered = new Set<CatalogEntry>()
const loaded = new Map<string, Catalog>()
const pending = new Map<string, Promise<void>>()

/** Bumped when a catalog loads, so `useT` re-renders with the new text. */
export const catalogVersionAtom = atom(0)

export const registerCatalog = (entry: CatalogEntry) => registered.add(entry)

export const getLoadedCatalog = (language: Language, namespace: string): Catalog | undefined =>
    loaded.get(`${language}:${namespace}`)

/** True while a catalog's text in that language is still on its way. */
export const isCatalogLoading = (language: Language, namespace: string): boolean => {
    const id = `${language}:${namespace}`
    return pending.has(id) && !loaded.has(id)
}

export const loadCatalog = (entry: CatalogEntry, language: Language): Promise<void> => {
    const id = `${language}:${entry.namespace}`
    if (loaded.has(id)) return Promise.resolve()
    let promise = pending.get(id)
    if (!promise) {
        promise = entry.load[language]().then((module) => {
            loaded.set(id, module.default)
            const store = getDefaultStore()
            store.set(catalogVersionAtom, store.get(catalogVersionAtom) + 1)
        })
        pending.set(id, promise)
        promise.catch(() => pending.delete(id))
    }
    return promise
}

/** Loads the language for every catalog the page has imported so far. */
export const loadLanguage = async (language: Language): Promise<void> => {
    await Promise.all([...registered].map((entry) => loadCatalog(entry, language)))
}
