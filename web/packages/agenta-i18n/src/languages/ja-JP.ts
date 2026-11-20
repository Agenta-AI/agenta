import type {Catalog} from "../registry"

/** Loads one ja-JP catalog file. The app loads this module only when a user picks ja-JP. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/ja-JP/${namespace}.json`)
