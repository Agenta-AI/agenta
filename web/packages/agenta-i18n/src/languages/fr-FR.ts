import type {Catalog} from "../registry"

/** Loads one fr-FR catalog file. The app loads this module only when a user picks fr-FR. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/fr-FR/${namespace}.json`)
