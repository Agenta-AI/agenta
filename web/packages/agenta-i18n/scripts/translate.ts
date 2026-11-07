/**
 * Fills translated catalogs with an LLM. Sends only keys that are missing or whose
 * English text changed since the last run (sha256 in locales/.meta/<lang>.json),
 * adopts values that have no recorded hash, and drops keys English no longer has.
 *
 * Usage: node scripts/translate.ts [--lang <lang>] [--namespace <name>] [--dry-run]
 * Env: ANTHROPIC_API_KEY (required unless --dry-run), AGENTA_I18N_MODEL (default claude-sonnet-5-5)
 */
import {existsSync, mkdirSync, readFileSync} from "node:fs"
import {dirname, join} from "node:path"
import {pathToFileURL} from "node:url"

import {
    LOCALES_DIR,
    PACKAGE_DIR,
    SOURCE_LANG,
    catalogPath,
    flagValue,
    listNamespaces,
    metaPath,
    readJson,
    samePlaceholders,
    sha256,
    targetKeys,
    targetLanguages,
    writeJson,
} from "./catalog.ts"
import type {Catalog} from "./catalog.ts"

export const DEFAULT_MODEL = "claude-sonnet-5-5"
const BATCH_SIZE = 40

/** Translation memory: namespace, then key inside it, then sha256 of the English text. */
export type Meta = Record<string, Catalog>

export interface Item {
    key: string
    en: string
}

export interface Usage {
    inputTokens: number
    outputTokens: number
}

/** Translates a batch; returns the translated text by key. */
export type TranslateBatch = (items: Item[]) => Promise<{translations: Catalog; usage: Usage}>

export interface Plan {
    /** Every key the language needs, with the English text it translates. */
    wanted: Map<string, string>
    /** Keys to send to the model. */
    send: Item[]
    /** Keys whose existing value is kept and whose hash gets recorded. */
    adopt: string[]
    /** Keys English no longer has. */
    remove: string[]
}

export function planNamespace(source: Catalog, target: Catalog, meta: Catalog, lang: string): Plan {
    const wanted = targetKeys(source, lang)
    const plan: Plan = {wanted, send: [], adopt: [], remove: []}
    for (const [key, en] of wanted) {
        if (target[key] === undefined) plan.send.push({key, en})
        else if (meta[key] === undefined) plan.adopt.push(key)
        else if (meta[key] !== sha256(en)) plan.send.push({key, en})
    }
    plan.remove = Object.keys(target).filter((key) => !wanted.has(key))
    return plan
}

/** Errors whose message is safe to print: it never holds response text or the key. */
export class TranslateError extends Error {}

const STYLE: Record<string, {name: string; rules: string[]}> = {
    "zh-CN": {
        name: "Simplified Chinese (zh-CN)",
        rules: [
            "Write Simplified Chinese for users in mainland China. Keep a short, plain UI tone.",
            "Use full-width Chinese punctuation in sentences. Put a space between Chinese and Latin words or numbers.",
        ],
    },
    "ja-JP": {
        name: "Japanese (ja-JP)",
        rules: [
            "Write Japanese for users in Japan. Keep a short, plain UI tone. Use です/ます only where a full sentence is needed; labels and buttons stay short.",
            "Write loanwords in katakana as the glossary does. Use full-width Japanese punctuation in sentences. Put a space between Japanese and Latin words or numbers.",
        ],
    },
}

export function systemPrompt(lang: string, glossary: Record<string, string>): string {
    const style = STYLE[lang]
    if (!style) throw new TranslateError(`No style guide for ${lang}`)
    return [
        `You translate the user interface of Agenta, a platform to build, evaluate and observe LLM agents, from English to ${style.name}.`,
        "",
        "Style:",
        ...style.rules.map((rule) => `- ${rule}`),
        "- No trailing period on labels and buttons that have none in English.",
        "- Copy every {{placeholder}} exactly, including its name. Never translate, add or drop one.",
        "- Copy markup, tags, URLs, code and keyboard keys exactly.",
        "- Use the glossary terms below. Keep brand and product names in English.",
        "- The key name hints at where the text appears.",
        "",
        "Glossary (English => translation):",
        ...Object.entries(glossary).map(([term, text]) => `${term} => ${text}`),
        "",
        "Return one translation for every key you receive, with the same key.",
    ].join("\n")
}

const OUTPUT_SCHEMA = {
    type: "object",
    properties: {
        translations: {
            type: "array",
            items: {
                type: "object",
                properties: {key: {type: "string"}, text: {type: "string"}},
                required: ["key", "text"],
                additionalProperties: false,
            },
        },
    },
    required: ["translations"],
    additionalProperties: false,
}

export function anthropicTranslator(options: {
    apiKey: string
    model: string
    system: string
    fetchFn?: typeof fetch
}): TranslateBatch {
    const fetchFn = options.fetchFn ?? fetch
    return async (items) => {
        const response = await fetchFn("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": options.apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: options.model,
                max_tokens: 16000,
                system: [{type: "text", text: options.system, cache_control: {type: "ephemeral"}}],
                output_config: {
                    effort: "low",
                    format: {type: "json_schema", schema: OUTPUT_SCHEMA},
                },
                messages: [{role: "user", content: JSON.stringify(items, null, 1)}],
            }),
        })
        if (!response.ok) {
            throw new TranslateError(`Anthropic API returned HTTP ${response.status}`)
        }
        const body = (await response.json()) as {
            stop_reason?: string
            content?: {type: string; text?: string}[]
            usage?: {input_tokens: number; output_tokens: number}
        }
        if (body.stop_reason !== "end_turn") {
            throw new TranslateError("Anthropic API did not finish the answer")
        }
        const text = body.content?.find((block) => block.type === "text")?.text
        if (text === undefined) throw new TranslateError("Anthropic API answer has no text")
        const parsed = JSON.parse(text) as {translations: {key: string; text: string}[]}
        return {
            translations: Object.fromEntries(parsed.translations.map((t) => [t.key, t.text])),
            usage: {
                inputTokens: body.usage?.input_tokens ?? 0,
                outputTokens: body.usage?.output_tokens ?? 0,
            },
        }
    }
}

export interface NamespaceResult {
    catalog: Catalog
    /** Hashes for this namespace's keys. */
    meta: Catalog
    rejected: string[]
    usage: Usage
}

/** Applies a plan: translates in batches, rejects answers whose placeholders or tags differ. */
export async function translateNamespace(
    plan: Plan,
    target: Catalog,
    meta: Catalog,
    translate: TranslateBatch,
    batchSize = BATCH_SIZE,
): Promise<NamespaceResult> {
    const next: Catalog = {...target}
    const nextMeta: Catalog = {...meta}
    const result: NamespaceResult = {
        catalog: {},
        meta: {},
        rejected: [],
        usage: {inputTokens: 0, outputTokens: 0},
    }
    for (const key of plan.adopt) nextMeta[key] = sha256(plan.wanted.get(key) as string)
    for (let i = 0; i < plan.send.length; i += batchSize) {
        const batch = plan.send.slice(i, i + batchSize)
        const {translations, usage} = await translate(batch)
        result.usage.inputTokens += usage.inputTokens
        result.usage.outputTokens += usage.outputTokens
        for (const {key, en} of batch) {
            const text = translations[key]
            if (typeof text !== "string" || text.trim() === "" || !samePlaceholders(en, text)) {
                result.rejected.push(key)
                continue
            }
            next[key] = text
            nextMeta[key] = sha256(en)
        }
    }
    // Keep English key order; drop keys English no longer has.
    for (const key of plan.wanted.keys()) {
        if (next[key] !== undefined) result.catalog[key] = next[key]
        if (nextMeta[key] !== undefined) result.meta[key] = nextMeta[key]
    }
    return result
}

/** Keeps only namespaces English still has, sorted. */
function cleanMeta(meta: Meta, namespaces: string[]): Meta {
    return Object.fromEntries(
        Object.keys(meta)
            .filter((ns) => namespaces.includes(ns))
            .sort()
            .map((ns) => [ns, meta[ns]]),
    )
}

async function translateLanguage(
    lang: string,
    namespaces: string[],
    options: {dryRun: boolean; apiKey: string; model: string},
): Promise<{usage: Usage; rejected: number}> {
    const glossaryFile = join(PACKAGE_DIR, `glossary.${lang}.json`)
    if (!existsSync(glossaryFile)) throw new TranslateError(`No glossary.${lang}.json`)
    const glossary = JSON.parse(readFileSync(glossaryFile, "utf8")) as Record<string, string>
    const translate = anthropicTranslator({
        apiKey: options.apiKey,
        model: options.model,
        system: systemPrompt(lang, glossary),
    })
    const metaFile = metaPath(LOCALES_DIR, lang)
    const meta = readJson(metaFile) as Meta
    const total = {usage: {inputTokens: 0, outputTokens: 0}, rejected: 0}

    for (const ns of namespaces) {
        const source = readJson(catalogPath(LOCALES_DIR, SOURCE_LANG, ns)) as Catalog
        const targetFile = catalogPath(LOCALES_DIR, lang, ns)
        const target = readJson(targetFile) as Catalog
        const plan = planNamespace(source, target, meta[ns] ?? {}, lang)
        console.log(
            `${lang}/${ns}: ${plan.send.length} to translate, ${plan.adopt.length} to adopt, ${plan.remove.length} to remove`,
        )
        if (options.dryRun) {
            for (const item of plan.send) console.log(`  send   ${ns}.${item.key}: ${item.en}`)
            for (const key of plan.adopt) console.log(`  adopt  ${ns}.${key}`)
            for (const key of plan.remove) console.log(`  remove ${ns}.${key}`)
            continue
        }
        const result = await translateNamespace(plan, target, meta[ns] ?? {}, translate)
        total.usage.inputTokens += result.usage.inputTokens
        total.usage.outputTokens += result.usage.outputTokens
        total.rejected += result.rejected.length
        for (const key of result.rejected) {
            console.error(
                `  rejected ${lang}/${ns}.${key}: missing answer, or placeholders or tags differ`,
            )
        }
        // Write after each namespace so a later failure keeps finished work.
        mkdirSync(dirname(targetFile), {recursive: true})
        writeJson(targetFile, result.catalog)
        meta[ns] = result.meta
        mkdirSync(dirname(metaFile), {recursive: true})
        writeJson(metaFile, cleanMeta(meta, listNamespaces(LOCALES_DIR, SOURCE_LANG)))
    }
    return total
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run")
    const only = flagValue(argv, "--namespace")
    const lang = flagValue(argv, "--lang")
    const sourceNamespaces = listNamespaces(LOCALES_DIR, SOURCE_LANG)
    if (only && !sourceNamespaces.includes(only)) {
        console.error(`No English catalog for namespace "${only}".`)
        return 1
    }
    const model = process.env.AGENTA_I18N_MODEL || DEFAULT_MODEL
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ""
    if (!dryRun && !apiKey) {
        console.error("Set ANTHROPIC_API_KEY, or run with --dry-run.")
        return 1
    }
    let rejected = 0
    const usage: Usage = {inputTokens: 0, outputTokens: 0}
    for (const target of lang ? [lang] : targetLanguages(LOCALES_DIR)) {
        const result = await translateLanguage(target, only ? [only] : sourceNamespaces, {
            dryRun,
            apiKey,
            model,
        })
        rejected += result.rejected
        usage.inputTokens += result.usage.inputTokens
        usage.outputTokens += result.usage.outputTokens
    }
    if (dryRun) return 0
    console.log(
        `Model ${model}: ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens.`,
    )
    if (rejected > 0) {
        console.error(`${rejected} key(s) rejected. Run again to retry them.`)
        return 1
    }
    return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then(
        (code) => process.exit(code),
        (error: unknown) => {
            const reason = error instanceof TranslateError ? `: ${error.message}` : ""
            console.error(`Translation stopped${reason}. Files written so far are kept.`)
            process.exit(1)
        },
    )
}
