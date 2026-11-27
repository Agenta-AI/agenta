import type {Catalog} from "../registry"

/** Loads one zh-CN catalog file. The app loads this module only when a user picks zh-CN. */
export const loadNamespace = (namespace: string): Promise<{default: Catalog}> =>
    import(`../../locales/zh-CN/${namespace}.json`)
