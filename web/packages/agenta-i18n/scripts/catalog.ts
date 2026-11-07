import {createHash} from "node:crypto"
import {existsSync, readdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"

export type Catalog = Record<string, string>

export const SOURCE_LANG = "en"
export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const LOCALES_DIR = join(PACKAGE_DIR, "locales")

/** Every language folder in locales/ except English and dot folders. */
export function targetLanguages(localesDir: string): string[] {
    if (!existsSync(localesDir)) return []
    return readdirSync(localesDir, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .filter((name) => name !== SOURCE_LANG)
        .sort()
}

/** Value of `--name <value>`, or undefined when the flag is absent. */
export function flagValue(argv: string[], name: string): string | undefined {
    const index = argv.indexOf(name)
    if (index === -1) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`)
    return value
}

const PLURAL_SUFFIX = /^(.+)_(zero|one|two|few|many|other)$/

export function listNamespaces(localesDir: string, lang: string): string[] {
    const dir = join(localesDir, lang)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => file.slice(0, -".json".length))
        .sort()
}

export function readJson(path: string): Record<string, unknown> {
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

export function writeJson(path: string, value: Record<string, unknown>): void {
    writeFileSync(path, `${JSON.stringify(value, null, 4)}\n`)
}

export function catalogPath(localesDir: string, lang: string, namespace: string): string {
    return join(localesDir, lang, `${namespace}.json`)
}

export function metaPath(localesDir: string, lang: string): string {
    return join(localesDir, ".meta", `${lang}.json`)
}

// Same tag pattern as richText() in src/index.ts.
const TAG = /<\/?\w+>/g

/** Sorted `{{name}}` placeholders (once each) and rich-text tags like `<link>` (every occurrence). */
export function placeholders(text: string): string[] {
    const names = new Set<string>()
    for (const match of text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) names.add(`{{${match[1]}}}`)
    return [...names, ...(text.match(TAG) ?? [])].sort()
}

/** True when every closing tag follows an opening tag of the same name. */
export function tagsInOrder(text: string): boolean {
    const open = new Map<string, number>()
    for (const tag of text.match(TAG) ?? []) {
        const name = tag.replace(/[</>]/g, "")
        const count = (open.get(name) ?? 0) + (tag.startsWith("</") ? -1 : 1)
        if (count < 0) return false
        open.set(name, count)
    }
    return [...open.values()].every((count) => count === 0)
}

/** Same placeholders and tags as the English text, with the tags in a valid order. */
export function samePlaceholders(en: string, translated: string): boolean {
    return (
        placeholders(en).join("\u0000") === placeholders(translated).join("\u0000") &&
        tagsInOrder(translated)
    )
}

export function sha256(text: string): string {
    return createHash("sha256").update(text).digest("hex")
}

/** Splits "invite_other" into ["invite", "other"]; a non-plural key returns [key, null]. */
export function splitPlural(key: string): [string, string | null] {
    const match = PLURAL_SUFFIX.exec(key)
    return match ? [match[1], match[2]] : [key, null]
}

export function pluralCategories(lang: string): string[] {
    return new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[]
}

/**
 * Maps every key the target catalog must have to the English text it translates.
 * A plural family gets the target language's categories; each one translates the
 * English form of the same category, or the English `_other` form.
 */
export function targetKeys(source: Catalog, targetLang: string): Map<string, string> {
    const categories = pluralCategories(targetLang)
    const result = new Map<string, string>()
    for (const key of Object.keys(source)) {
        const [base, category] = splitPlural(key)
        if (category === null) {
            result.set(key, source[key])
            continue
        }
        for (const target of categories) {
            const targetKey = `${base}_${target}`
            if (result.has(targetKey)) continue
            const text = source[targetKey] ?? source[`${base}_other`]
            if (text !== undefined) result.set(targetKey, text)
        }
    }
    return result
}
