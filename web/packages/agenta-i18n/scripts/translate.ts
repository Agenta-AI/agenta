/**
 * Fills zh-CN catalogs with an LLM. Sends only keys that are missing or whose
 * English text changed since the last run (sha256 in locales/.meta/zh-CN.json),
 * adopts zh-CN values that have no recorded hash, and drops keys English no longer has.
 *
 * Usage: node scripts/translate.ts [--namespace <name>] [--dry-run]
 * Env: ANTHROPIC_API_KEY (required unless --dry-run), AGENTA_I18N_MODEL (default claude-sonnet-5-5),
 * ANTHROPIC_BASE_URL (optional)
 */
import {existsSync, mkdirSync, readFileSync, rmSync} from "node:fs"
import {dirname, join} from "node:path"
import {pathToFileURL} from "node:url"

import {
    LOCALES_DIR,
    PACKAGE_DIR,
    SOURCE_LANG,
    TARGET_LANG,
    catalogPath,
    listNamespaces,
    metaPath,
    readJson,
    samePlaceholders,
    sha256,
    targetKeys,
    writeJson,
} from "./catalog.ts"
import type {Catalog} from "./catalog.ts"
import {parseNamespace} from "./check.ts"

export const DEFAULT_MODEL = "claude-sonnet-5-5"
const BATCH_SIZE = 40

export interface Item {
    key: string
    en: string
}

export interface Usage {
    inputTokens: number
    outputTokens: number
}

/** Translates a batch; returns zh-CN text by key. */
export type TranslateBatch = (items: Item[]) => Promise<{translations: Catalog; usage: Usage}>

export interface Plan {
    /** Keys (inside the namespace) to send to the model, with their English text. */
    send: Item[]
    /** Keys whose existing zh-CN value is kept and whose hash gets recorded. */
    adopt: string[]
    /** zh-CN keys English no longer has. */
    remove: string[]
}

/** `meta` holds hashes for this namespace's keys only, keyed by the key inside the namespace. */
export function planNamespace(source: Catalog, target: Catalog, meta: Catalog): Plan {
    const wanted = targetKeys(source, TARGET_LANG)
    const plan: Plan = {send: [], adopt: [], remove: []}
    for (const [key, en] of wanted) {
        if (target[key] === undefined) plan.send.push({key, en})
        else if (meta[key] === undefined) plan.adopt.push(key)
        else if (meta[key] !== sha256(en)) plan.send.push({key, en})
    }
    plan.remove = Object.keys(target).filter((key) => !wanted.has(key))
    return plan
}

export function glossaryPrompt(glossary: Record<string, {zh: string; note: string}>): string {
    return Object.entries(glossary)
        .map(([term, {zh}]) => `${term} => ${zh}`)
        .join("\n")
}

export function systemPrompt(glossary: string): string {
    return [
        "You translate the user interface of Agenta, a platform to build, evaluate and observe LLM agents, from English to Simplified Chinese (zh-CN).",
        "",
        "Style:",
        "- Write Simplified Chinese for users in mainland China. Keep a short, plain UI tone. No trailing period on labels and buttons that have none in English.",
        "- Use full-width Chinese punctuation in sentences. Put a space between Chinese and Latin words or numbers.",
        "- Copy every {{placeholder}} exactly, including its name. Never translate, add or drop one.",
        "- Copy markup, tags, URLs, code and keyboard keys exactly.",
        "- Use the glossary terms below. Keep brand and product names in English.",
        "- The key name hints at where the text appears.",
        "",
        "Glossary (English => Chinese):",
        glossary,
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
                properties: {key: {type: "string"}, zh: {type: "string"}},
                required: ["key", "zh"],
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
    baseUrl?: string
    fetchFn?: typeof fetch
}): TranslateBatch {
    const fetchFn = options.fetchFn ?? fetch
    const baseUrl = options.baseUrl ?? "https://api.anthropic.com"
    return async (items) => {
        const response = await fetchFn(`${baseUrl}/v1/messages`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": options.apiKey,
                "anthropic-version": "2026-10-21",
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
        const body = (await response.json()) as {
            stop_reason?: string
            content?: {type: string; text?: string}[]
            usage?: {input_tokens: number; output_tokens: number}
            error?: {message: string}
        }
        if (!response.ok) {
            throw new Error(
                `Anthropic API ${response.status}: ${body.error?.message ?? "no message"}`,
            )
        }
        if (body.stop_reason !== "end_turn") {
            throw new Error(`Anthropic API stopped with ${body.stop_reason}`)
        }
        const text = body.content?.find((block) => block.type === "text")?.text ?? "{}"
        const parsed = JSON.parse(text) as {translations: {key: string; zh: string}[]}
        return {
            translations: Object.fromEntries(parsed.translations.map((t) => [t.key, t.zh])),
            usage: {
                inputTokens: body.usage?.input_tokens ?? 0,
                outputTokens: body.usage?.output_tokens ?? 0,
            },
        }
    }
}

export interface NamespaceResult {
    catalog: Catalog
    /** Hashes for this namespace's keys, keyed by the key inside the namespace. */
    meta: Catalog
    translated: string[]
    rejected: string[]
    usage: Usage
}

/** Applies a plan: translates in batches, rejects answers whose placeholders differ. */
export async function translateNamespace(
    source: Catalog,
    target: Catalog,
    meta: Catalog,
    translate: TranslateBatch,
    batchSize = BATCH_SIZE,
): Promise<NamespaceResult> {
    const plan = planNamespace(source, target, meta)
    const wanted = targetKeys(source, TARGET_LANG)
    const next: Catalog = {...target}
    const nextMeta: Catalog = {...meta}
    const result: NamespaceResult = {
        catalog: {},
        meta: {},
        translated: [],
        rejected: [],
        usage: {inputTokens: 0, outputTokens: 0},
    }
    for (const key of plan.adopt) nextMeta[key] = sha256(wanted.get(key) as string)
    for (let i = 0; i < plan.send.length; i += batchSize) {
        const batch = plan.send.slice(i, i + batchSize)
        const {translations, usage} = await translate(batch)
        result.usage.inputTokens += usage.inputTokens
        result.usage.outputTokens += usage.outputTokens
        for (const {key, en} of batch) {
            const zh = translations[key]
            if (typeof zh !== "string" || zh.trim() === "" || !samePlaceholders(en, zh)) {
                result.rejected.push(key)
                continue
            }
            next[key] = zh
            nextMeta[key] = sha256(en)
            result.translated.push(key)
        }
    }
    // Keep English key order; drop keys English no longer has.
    for (const key of wanted.keys()) {
        if (next[key] !== undefined) result.catalog[key] = next[key]
        if (nextMeta[key] !== undefined) result.meta[key] = nextMeta[key]
    }
    return result
}

/** Splits the flat meta file into this namespace's entries, keyed inside the namespace. */
export function namespaceMeta(meta: Catalog, namespace: string): Catalog {
    const prefix = `${namespace}.`
    return Object.fromEntries(
        Object.entries(meta)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, hash]) => [key.slice(prefix.length), hash]),
    )
}

export function mergeMeta(meta: Catalog, namespace: string, entries: Catalog): Catalog {
    const prefix = `${namespace}.`
    const merged = Object.fromEntries(
        Object.entries(meta).filter(([key]) => !key.startsWith(prefix)),
    )
    for (const [key, hash] of Object.entries(entries)) merged[`${prefix}${key}`] = hash
    return Object.fromEntries(
        Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    )
}

async function main(argv: string[]): Promise<number> {
    const dryRun = argv.includes("--dry-run")
    const only = parseNamespace(argv)
    const sourceNamespaces = listNamespaces(LOCALES_DIR, SOURCE_LANG)
    const namespaces = only
        ? [only]
        : [...new Set([...sourceNamespaces, ...listNamespaces(LOCALES_DIR, TARGET_LANG)])].sort()
    if (only && !sourceNamespaces.includes(only)) {
        console.error(`No English catalog for namespace "${only}".`)
        return 1
    }
    const metaFile = metaPath(LOCALES_DIR, TARGET_LANG)
    let meta = readJson(metaFile) as Catalog
    const model = process.env.AGENTA_I18N_MODEL || DEFAULT_MODEL
    const apiKey = process.env.ANTHROPIC_API_KEY ?? ""
    if (!dryRun && !apiKey) {
        console.error("Set ANTHROPIC_API_KEY, or run with --dry-run.")
        return 1
    }
    const glossary = JSON.parse(
        readFileSync(join(PACKAGE_DIR, "glossary.zh-CN.json"), "utf8"),
    ) as Record<string, {zh: string; note: string}>
    const translate = anthropicTranslator({
        apiKey,
        model,
        system: systemPrompt(glossaryPrompt(glossary)),
        baseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
    })
    const total: Usage = {inputTokens: 0, outputTokens: 0}
    let rejected = 0

    for (const ns of namespaces) {
        const source = readJson(catalogPath(LOCALES_DIR, SOURCE_LANG, ns)) as Catalog
        const targetFile = catalogPath(LOCALES_DIR, TARGET_LANG, ns)
        const target = readJson(targetFile) as Catalog
        const nsMeta = namespaceMeta(meta, ns)
        const plan = planNamespace(source, target, nsMeta)
        console.log(
            `${ns}: ${plan.send.length} to translate, ${plan.adopt.length} to adopt, ${plan.remove.length} to remove`,
        )
        if (dryRun) {
            for (const item of plan.send) console.log(`  send   ${ns}.${item.key}: ${item.en}`)
            for (const key of plan.adopt) console.log(`  adopt  ${ns}.${key}`)
            for (const key of plan.remove) console.log(`  remove ${ns}.${key}`)
            continue
        }
        const result = await translateNamespace(source, target, nsMeta, translate)
        total.inputTokens += result.usage.inputTokens
        total.outputTokens += result.usage.outputTokens
        rejected += result.rejected.length
        for (const key of result.rejected) {
            console.error(`  rejected ${ns}.${key}: missing answer or placeholders differ`)
        }
        if (!sourceNamespaces.includes(ns)) {
            if (existsSync(targetFile)) rmSync(targetFile)
        } else {
            mkdirSync(dirname(targetFile), {recursive: true})
            writeJson(targetFile, result.catalog)
        }
        meta = mergeMeta(meta, ns, result.meta)
    }
    if (dryRun) return 0
    mkdirSync(dirname(metaFile), {recursive: true})
    writeJson(metaFile, meta)
    console.log(
        `Model ${model}: ${total.inputTokens} input tokens, ${total.outputTokens} output tokens.`,
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
            console.error(error instanceof Error ? error.message : error)
            process.exit(1)
        },
    )
}
