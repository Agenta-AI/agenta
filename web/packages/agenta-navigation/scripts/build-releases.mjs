#!/usr/bin/env node
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const ENTRIES_DIR = resolve(here, "../../../../docs/blog/entries")
const OUT_FILE = resolve(here, "../src/releases/changelog.json")
const DOCS_ORIGIN = "https://agenta.ai/docs"
const KEEP_VERSIONS = 10
const VERSION_TAG = /^v\d+\.\d+\.\d+$/

const unquote = (raw) => {
    const value = raw.trim()
    if (value.startsWith('"')) return JSON.parse(value)
    if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
    return value
}

const parseInlineList = (raw) =>
    raw
        .trim()
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => unquote(item))
        .filter(Boolean)

// Parses only the frontmatter subset the changelog uses, and throws on anything else.
const parseFrontmatter = (source, file) => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
    if (!match) throw new Error(`${file}: no frontmatter`)
    const data = {}
    let listKey = null
    for (const line of match[1].split("\n")) {
        if (!line.trim()) continue
        const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
        if (top) {
            const [, key, rest] = top
            listKey = null
            if (rest === "") {
                data[key] = []
                listKey = key
            } else if (rest.startsWith("[")) data[key] = parseInlineList(rest)
            else data[key] = unquote(rest)
            continue
        }
        const item = /^\s+-\s+([\w-]+):\s*(.+)$/.exec(line)
        const field = /^\s+([\w-]+):\s*(.+)$/.exec(line)
        if (listKey && item) data[listKey].push({[item[1]]: unquote(item[2])})
        else if (listKey && field && data[listKey].length > 0)
            data[listKey].at(-1)[field[1]] = unquote(field[2])
        else throw new Error(`${file}: unsupported frontmatter line: ${line}`)
    }
    return data
}

const parseItems = (value, key, file) => {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${file}: ${key} must be a list`)
    return value.map((entry) => {
        if (typeof entry?.area !== "string" || typeof entry?.text !== "string")
            throw new Error(`${file}: every ${key} item needs an area and a text`)
        return {area: entry.area, text: entry.text}
    })
}

const absolutizeLinks = (markdown) => markdown.replace(/\]\(\/(?!\/)/g, `](${DOCS_ORIGIN}/`)

// The app renders plain markdown, so MDX components, embeds and comments would show as raw text.
const stripMdx = (markdown) =>
    markdown
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/<(iframe|video|div)\b[\s\S]*?<\/\1>/g, "")
        .replace(/<[A-Za-z][^>]*\/>/g, "")
        // Escape what is left, so no fragment can form a tag in the app.
        .replace(/</g, "&lt;")
        .trim()

const semverParts = (id) => id.slice(1).split(".").map(Number)
const compareSemverDesc = (a, b) => {
    const [x, y] = [semverParts(a), semverParts(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]
    return 0
}

const entries = readdirSync(ENTRIES_DIR)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => {
        const source = readFileSync(join(ENTRIES_DIR, name), "utf8")
        const data = parseFrontmatter(source, name)
        const version = (Array.isArray(data.tags) ? data.tags : []).find((tag) =>
            VERSION_TAG.test(tag),
        )
        if (!version) return null
        for (const key of ["title", "slug", "date"])
            if (typeof data[key] !== "string" || !data[key])
                throw new Error(`${name}: missing ${key}`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date))
            throw new Error(`${name}: date must be YYYY-MM-DD`)
        const summary = /<Summary>([\s\S]*?)<\/Summary>/.exec(source)
        if (!summary) throw new Error(`${name}: a versioned entry needs a <Summary>`)
        const stream =
            /<Stream\b[^>]*?\bsrc="([^"]+)"/.exec(source) ??
            /cloudflarestream\.com\/([0-9a-f]{32})\//.exec(source)
        return {
            version,
            date: data.date,
            feature: {
                id: data.slug,
                title: data.title,
                body: absolutizeLinks(stripMdx(summary[1])),
                link: `${DOCS_ORIGIN}/changelog/${data.slug}`,
                ...(stream ? {streamVideoId: stream[1]} : {}),
            },
            improvements: parseItems(data.improvements, "improvements", name),
            fixes: parseItems(data.fixes, "fixes", name),
        }
    })
    .filter(Boolean)

const byVersion = new Map()
for (const entry of entries) {
    const group = byVersion.get(entry.version) ?? []
    group.push(entry)
    byVersion.set(entry.version, group)
}

const releases = [...byVersion.entries()]
    .map(([id, group]) => {
        group.sort(
            (a, b) => b.date.localeCompare(a.date) || a.feature.id.localeCompare(b.feature.id),
        )
        return {
            id,
            date: group[0].date,
            features: group.map((entry) => entry.feature),
            improvements: group.flatMap((entry) => entry.improvements),
            fixes: group.flatMap((entry) => entry.fixes),
        }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || compareSemverDesc(a.id, b.id))
    .slice(0, KEEP_VERSIONS)

const output = `${JSON.stringify(releases, null, 4)}\n`
if (process.argv.includes("--check")) {
    if (readFileSync(OUT_FILE, "utf8") !== output) {
        console.error(
            `${OUT_FILE} is out of date. Run: pnpm --filter @agenta/navigation generate:releases`,
        )
        process.exit(1)
    }
    process.exit(0)
}
writeFileSync(OUT_FILE, output)
console.log(
    `Wrote ${releases.length} releases to ${OUT_FILE}:\n` +
        releases.map((r) => `  ${r.id} ${r.date} (${r.features.length} features)`).join("\n"),
)
