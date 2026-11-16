import type {Catalog} from "../registry"

/** Loads one es-ES catalog file. The app loads this module only when a user picks es-ES. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/es-ES/${namespace}.json`)
