import type {Catalog} from "../registry"

/** Loads one pt-BR catalog file. The app loads this module only when a user picks pt-BR. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/pt-BR/${namespace}.json`)
