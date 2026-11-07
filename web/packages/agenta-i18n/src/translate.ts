import type {Language} from "./language"
import {getLoadedCatalog, isCatalogLoading, type Catalog, type CatalogEntry} from "./registry"

export type TranslationValues = Record<string, string | number>

const pluralRules = new Map<Language, Intl.PluralRules>()
const pluralCategory = (language: Language, count: number) => {
    let rules = pluralRules.get(language)
    if (!rules) {
        rules = new Intl.PluralRules(language)
        pluralRules.set(language, rules)
    }
    return rules.select(count)
}

const lookup = (
    catalog: Catalog | undefined,
    language: Language,
    key: string,
    count: unknown,
): string | undefined => {
    if (!catalog) return undefined
    if (typeof count === "number") {
        return (
            catalog[`${key}_${pluralCategory(language, count)}`] ??
            catalog[`${key}_other`] ??
            catalog[key]
        )
    }
    return catalog[key]
}

const interpolate = (text: string, values?: TranslationValues) =>
    values
        ? text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
              name in values ? String(values[name]) : match,
          )
        : text

/**
 * Looks up `key` in the catalog whose namespace starts it: the language's text, then English,
 * then the key itself; "" while the English is still loading. `_version` only marks which catalog load a bound `t` was made after.
 */
export const translate = (
    language: Language,
    key: string,
    values: TranslationValues | undefined,
    catalogs: readonly CatalogEntry[],
    _version?: number,
): string => {
    const entry = catalogs.find((catalog) => key.startsWith(`${catalog.namespace}.`))
    if (!entry) return key
    const rest = key.slice(entry.namespace.length + 1)
    const count = values?.count
    const english = getLoadedCatalog("en", entry.namespace)
    // Nothing until the text arrives, so neither the key nor English flashes on screen.
    if (!english || (language !== "en" && isCatalogLoading(language, entry.namespace))) return ""
    const text =
        (language === "en"
            ? undefined
            : lookup(getLoadedCatalog(language, entry.namespace), language, rest, count)) ??
        lookup(english, "en", rest, count) ??
        key
    return interpolate(text, values)
}
