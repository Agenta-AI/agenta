import type {Catalogs} from "./language"

/** Types only: each namespace's English catalog is bundled by its own entry (`./settings`, ...). */
interface EnCatalogs {
    billing: typeof import("../locales/en/billing.json")
    channels: typeof import("../locales/en/channels.json")
    common: typeof import("../locales/en/common.json")
    navigation: typeof import("../locales/en/navigation.json")
    publish: typeof import("../locales/en/publish.json")
    settings: typeof import("../locales/en/settings.json")
}

export type Namespace = keyof EnCatalogs & string
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other"
type BaseKey<K> = K extends `${infer Base}_${PluralSuffix}` ? Base : K

/** "<namespace>.<key>", checked against the English catalogs. Plural keys drop their suffix. */
export type TranslationKey<NS extends Namespace = Namespace> = {
    [N in NS]: `${N}.${BaseKey<Exclude<keyof EnCatalogs[N], "default"> & string>}`
}[NS]

/** English catalogs of the namespaces loaded so far; filled by {@link defineNamespace}. */
export const EN_CATALOGS: Catalogs = {}
