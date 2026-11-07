/**
 * Checks that the zh-CN catalogs match the English ones: same keys, same
 * placeholders, complete plural families.
 *
 * Usage: node scripts/check.ts [--namespace <name>]
 */
import {pathToFileURL} from "node:url"

import {
    LOCALES_DIR,
    SOURCE_LANG,
    TARGET_LANG,
    catalogPath,
    listNamespaces,
    placeholders,
    pluralCategories,
    readJson,
    splitPlural,
} from "./catalog.ts"

interface Family {
    /** Plural categories present, or null for a plain key. */
    categories: string[] | null
    placeholders: string[]
}

function families(catalog: Record<string, unknown>): {
    families: Map<string, Family>
    invalid: string[]
} {
    const result = new Map<string, Family>()
    const invalid: string[] = []
    for (const [key, value] of Object.entries(catalog)) {
        if (typeof value !== "string") {
            invalid.push(key)
            continue
        }
        const [base, category] = splitPlural(key)
        const family = result.get(base) ?? {
            categories: category === null ? null : [],
            placeholders: [],
        }
        if (category !== null) family.categories = [...(family.categories ?? []), category]
        family.placeholders = [...new Set([...family.placeholders, ...placeholders(value)])].sort()
        result.set(base, family)
    }
    return {families: result, invalid}
}

function pluralProblems(base: string, family: Family, lang: string): string[] {
    if (family.categories === null) return []
    const required = pluralCategories(lang)
    const missing = required.filter((c) => !family.categories?.includes(c))
    const extra = family.categories.filter((c) => !required.includes(c))
    return [
        ...missing.map((c) => `${lang} misses plural form ${base}_${c}`),
        ...extra.map((c) => `${lang} has unused plural form ${base}_${c}`),
    ]
}

export function checkNamespace(
    namespace: string,
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    sourceLang = SOURCE_LANG,
    targetLang = TARGET_LANG,
): string[] {
    const problems: string[] = []
    const src = families(source)
    const tgt = families(target)
    for (const key of src.invalid) problems.push(`${sourceLang} value is not a string: ${key}`)
    for (const key of tgt.invalid) problems.push(`${targetLang} value is not a string: ${key}`)

    for (const [base, family] of src.families) {
        const other = tgt.families.get(base)
        problems.push(...pluralProblems(base, family, sourceLang))
        if (!other) {
            problems.push(`missing in ${targetLang}: ${base}`)
            continue
        }
        if ((family.categories === null) !== (other.categories === null)) {
            problems.push(`plural in only one language: ${base}`)
            continue
        }
        problems.push(...pluralProblems(base, other, targetLang))
        if (family.placeholders.join() !== other.placeholders.join()) {
            const fmt = (names: string[]) => names.map((n) => `{{${n}}}`).join(" ") || "none"
            problems.push(
                `placeholders differ in ${base}: ${sourceLang} has ${fmt(family.placeholders)}, ${targetLang} has ${fmt(other.placeholders)}`,
            )
        }
    }
    for (const base of tgt.families.keys()) {
        if (!src.families.has(base)) problems.push(`not in ${sourceLang}: ${base}`)
    }
    return problems.map((problem) => `${namespace}: ${problem}`)
}

export function checkLocales(localesDir: string, namespace?: string): string[] {
    const all = [
        ...new Set([
            ...listNamespaces(localesDir, SOURCE_LANG),
            ...listNamespaces(localesDir, TARGET_LANG),
        ]),
    ].sort()
    if (namespace && !all.includes(namespace))
        return [`${namespace}: no catalog in either language`]
    const problems: string[] = []
    for (const ns of namespace ? [namespace] : all) {
        problems.push(
            ...checkNamespace(
                ns,
                readJson(catalogPath(localesDir, SOURCE_LANG, ns)),
                readJson(catalogPath(localesDir, TARGET_LANG, ns)),
            ),
        )
    }
    return problems
}

export function parseNamespace(argv: string[]): string | undefined {
    const index = argv.indexOf("--namespace")
    if (index === -1) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error("--namespace needs a value")
    return value
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const problems = checkLocales(LOCALES_DIR, parseNamespace(process.argv.slice(2)))
    if (problems.length > 0) {
        console.error(`i18n check found ${problems.length} problem(s):`)
        for (const problem of problems) console.error(`  - ${problem}`)
        console.error("Run `pnpm i18n:translate` to fill zh-CN, or fix the catalogs by hand.")
        process.exit(1)
    }
    console.log("i18n check passed.")
}
