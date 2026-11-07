import {EN_CATALOGS} from "./catalogs"
import {getLoadedCatalogs, type Catalogs, type Language} from "./language"

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
    catalogs: Catalogs | undefined,
    language: Language,
    namespace: string,
    key: string,
    count: unknown,
): string | undefined => {
    const catalog = catalogs?.[namespace]
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

/** Looks up `key` in `language`, then English, then returns the key itself. */
export const translate = (language: Language, key: string, values?: TranslationValues): string => {
    const dot = key.indexOf(".")
    const namespace = key.slice(0, dot)
    const rest = key.slice(dot + 1)
    const count = values?.count
    const text =
        (language === "en"
            ? undefined
            : lookup(getLoadedCatalogs(language), language, namespace, rest, count)) ??
        lookup(EN_CATALOGS, "en", namespace, rest, count) ??
        key
    return interpolate(text, values)
}
