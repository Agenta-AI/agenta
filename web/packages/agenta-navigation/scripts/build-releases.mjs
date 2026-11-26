#!/usr/bin/env node
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"

import {parseEntry} from "./parse-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const ENTRIES_DIR = resolve(here, "../../../../docs/blog/entries")
const OUT_FILE = resolve(here, "../src/releases/changelog.json")
const KEEP_VERSIONS = 10

const semverParts = (id) => id.slice(1).split(".").map(Number)
const compareSemverDesc = (a, b) => {
    const [x, y] = [semverParts(a), semverParts(b)]
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]
    return 0
}

const entries = readdirSync(ENTRIES_DIR)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => parseEntry(readFileSync(join(ENTRIES_DIR, name), "utf8"), name))
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
