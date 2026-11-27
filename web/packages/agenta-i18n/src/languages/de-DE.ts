import type {Catalog} from "../registry"

/** Loads one de-DE catalog file. The app loads this module only when a user picks de-DE. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/de-DE/${namespace}.json`)
