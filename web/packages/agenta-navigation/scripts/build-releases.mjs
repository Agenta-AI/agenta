#!/usr/bin/env node
import {readdirSync, readFileSync, writeFileSync} from "node:fs"
import {dirname, join, resolve} from "node:path"
import {fileURLToPath} from "node:url"

import {parseEntry} from "./parse-entry.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const ENTRIES_DIR = resolve(here, "../../../../docs/blog/entries")
const OUT_FILE = resolve(here, "../src/releases/changelog.json")
const NOTICES_FILE = resolve(here, "../src/releases/notices.json")
const KEEP_VERSIONS = 10
const VERSION_TAG = /^v\d+\.\d+\.\d+$/

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

const allReleases = [...byVersion.entries()]
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
            ...(group.some((entry) => entry.securityFix) ? {securityFix: true} : {}),
        }
    })
    .sort((a, b) => b.date.localeCompare(a.date) || compareSemverDesc(a.id, b.id))

const releases = allReleases.slice(0, KEEP_VERSIONS)
// An instance far behind must still hear about the newest security fix.
const newestSecurityFix = allReleases.find((release) => release.securityFix)
if (newestSecurityFix && !releases.includes(newestSecurityFix)) releases.push(newestSecurityFix)

const NOTICE_SEVERITIES = ["info", "warning"]
const NOTICE_EDITIONS = ["oss", "ee"]

// notices.json is hand-written, so a bad edit fails here rather than in the published feed.
const checkNotices = (notices) => {
    if (!Array.isArray(notices)) throw new Error(`${NOTICES_FILE}: must be a list`)
    // Instances read only the first 10 notices (`MAX_FEED_NOTICES` in src/releases/feed.ts).
    if (notices.length > 10) throw new Error(`${NOTICES_FILE}: at most 10 notices`)
    const ids = new Set()
    for (const notice of notices) {
        const where = `${NOTICES_FILE}: notice ${JSON.stringify(notice?.id)}`
        for (const key of ["id", "title", "body", "link"])
            if (typeof notice?.[key] !== "string" || !notice[key])
                throw new Error(`${where}: missing ${key}`)
        // The same limits as the client (`MAX_TITLE_LENGTH` and `MAX_BODY_LENGTH` in src/releases/feed.ts).
        if (notice.id.length > 300 || notice.title.length > 300 || notice.body.length > 20_000)
            throw new Error(`${where}: id and title take at most 300 characters, body 20000`)
        if (ids.has(notice.id)) throw new Error(`${where}: duplicate id`)
        ids.add(notice.id)
        if (notice.link.length > 2_000 || !/^https:\/\/[^\s]+$/.test(notice.link))
            throw new Error(
                `${where}: link must be an https URL with no spaces, at most 2000 characters`,
            )
        if (!NOTICE_SEVERITIES.includes(notice.severity))
            throw new Error(`${where}: severity must be one of ${NOTICE_SEVERITIES.join(", ")}`)
        if (
            notice.editions !== undefined &&
            !(
                Array.isArray(notice.editions) &&
                notice.editions.every((edition) => NOTICE_EDITIONS.includes(edition))
            )
        )
            throw new Error(`${where}: editions must list ${NOTICE_EDITIONS.join(", ")}`)
        if (
            notice.plans !== undefined &&
            !(Array.isArray(notice.plans) && notice.plans.every((plan) => typeof plan === "string"))
        )
            throw new Error(`${where}: plans must be a list of plan slugs`)
        for (const key of ["minVersion", "maxVersion"])
            if (notice[key] !== undefined && !VERSION_TAG.test(notice[key]))
                throw new Error(`${where}: ${key} must look like v0.128.0`)
    }
}
checkNotices(JSON.parse(readFileSync(NOTICES_FILE, "utf8")))

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
