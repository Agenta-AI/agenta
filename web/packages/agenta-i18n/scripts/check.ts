/**
 * Checks that every translated catalog matches the English one: the keys each
 * language needs (plural forms per Intl.PluralRules), no extra keys, and the
 * same placeholders and rich-text tags as the English text. A key "<namespace>.<key>" must belong to
 * exactly one catalog file, so no namespace may start with another namespace and a dot.
 *
 * Usage: node scripts/check.ts [--lang <lang>] [--namespace <name>]
 */
import {pathToFileURL} from "node:url"

import {
    LOCALES_DIR,
    SOURCE_LANG,
    catalogPath,
    flagValue,
    listNamespaces,
    placeholders,
    pluralCategories,
    readJson,
    samePlaceholders,
    splitPlural,
    targetKeys,
    targetLanguages,
} from "./catalog.ts"
import type {Catalog} from "./catalog.ts"

function fmt(tokens: string[]): string {
    return tokens.join(" ") || "none"
}

/** English plural families must have every English plural form. */
function sourceProblems(source: Record<string, unknown>): string[] {
    const problems: string[] = []
    const families = new Map<string, string[]>()
    for (const [key, value] of Object.entries(source)) {
        if (typeof value !== "string") problems.push(`${SOURCE_LANG} value is not a string: ${key}`)
        const [base, category] = splitPlural(key)
        if (category !== null) families.set(base, [...(families.get(base) ?? []), category])
    }
    const required = pluralCategories(SOURCE_LANG)
    for (const [base, categories] of families) {
        for (const category of required.filter((c) => !categories.includes(c))) {
            problems.push(`${SOURCE_LANG} misses plural form ${base}_${category}`)
        }
    }
    return problems
}

export function checkNamespace(
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    lang: string,
): string[] {
    const problems = sourceProblems(source)
    const strings = Object.fromEntries(
        Object.entries(source).filter(([, value]) => typeof value === "string"),
    ) as Catalog
    const wanted = targetKeys(strings, lang)
    for (const [key, en] of wanted) {
        const value = target[key]
        if (value === undefined) {
            problems.push(`missing in ${lang}: ${key}`)
        } else if (typeof value !== "string") {
            problems.push(`${lang} value is not a string: ${key}`)
        } else if (!samePlaceholders(en, value)) {
            problems.push(
                placeholders(en).join() !== placeholders(value).join()
                    ? `placeholders or tags differ in ${key}: ${SOURCE_LANG} has ${fmt(placeholders(en))}, ${lang} has ${fmt(placeholders(value))}`
                    : `a closing tag comes before its opening tag in ${key}`,
            )
        }
    }
    for (const key of Object.keys(target)) {
        if (!wanted.has(key)) problems.push(`${lang} has a key English does not need: ${key}`)
    }
    return problems
}

export function namespaceProblems(namespaces: string[]): string[] {
    return namespaces.flatMap((outer) =>
        namespaces
            .filter((inner) => inner.startsWith(`${outer}.`))
            .map(
                (inner) => `namespace ${inner} starts with namespace ${outer}; rename one of them`,
            ),
    )
}

export function checkLocales(localesDir: string, langs: string[], namespace?: string): string[] {
    const problems = namespaceProblems(listNamespaces(localesDir, SOURCE_LANG))
    for (const lang of langs) {
        const all = [
            ...new Set([
                ...listNamespaces(localesDir, SOURCE_LANG),
                ...listNamespaces(localesDir, lang),
            ]),
        ].sort()
        if (namespace && !all.includes(namespace)) {
            problems.push(`${lang}/${namespace}: no catalog in either language`)
            continue
        }
        for (const ns of namespace ? [namespace] : all) {
            const found = checkNamespace(
                readJson(catalogPath(localesDir, SOURCE_LANG, ns)),
                readJson(catalogPath(localesDir, lang, ns)),
                lang,
            )
            problems.push(...found.map((problem) => `${lang}/${ns}: ${problem}`))
        }
    }
    return problems
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const argv = process.argv.slice(2)
    const lang = flagValue(argv, "--lang")
    const problems = checkLocales(
        LOCALES_DIR,
        lang ? [lang] : targetLanguages(LOCALES_DIR),
        flagValue(argv, "--namespace"),
    )
    if (problems.length > 0) {
        console.error(`i18n check found ${problems.length} problem(s):`)
        for (const problem of problems) console.error(`  - ${problem}`)
        console.error("Run `pnpm i18n:translate` to fill the catalogs, or fix them by hand.")
        process.exit(1)
    }
    console.log("i18n check passed.")
}
