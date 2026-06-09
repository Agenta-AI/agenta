#!/usr/bin/env node
/**
 * Pain log schema validator for docs/design/ts-sdk-tracing/pain-log.md.
 *
 * Validates that every `## P-{FRAMEWORK}-NN:` entry has:
 *   1. ID prefix matches a known framework
 *   2. Framework field present + matches known set
 *   3. Severity has all 3 axes with valid values
 *   4. At least 2 code blocks (the friction snippet + the ideal sketch)
 *   5. No duplicate IDs across the file
 *
 * Plain Node ESM, no dependencies — easy to run from a pre-commit hook with
 * `node docs/design/ts-sdk-tracing/scripts/validate-pain-log.mjs` and zero
 * tooling install cost.
 *
 * Exit codes:
 *   0 — log is valid (or has no entries yet)
 *   1 — at least one validation error
 *   2 — log file missing or unreadable
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const LOG_PATH = resolve(here, "..", "pain-log.md")

const KNOWN_FRAMEWORKS = new Set([
    "node",
    "app-router-raw",
    "app-router-vercel",
    "pages-router-raw",
    "pages-router-vercel",
    "tanstack",
    "nuxt",
    "mastra",
    "common",
    "braintrust",
    "langfuse",
])

const FRAMEWORK_PREFIX = {
    node: "P-NODE-",
    "app-router-raw": "P-APP-RAW-",
    "app-router-vercel": "P-APP-VERCEL-",
    "pages-router-raw": "P-PAGES-RAW-",
    "pages-router-vercel": "P-PAGES-VERCEL-",
    tanstack: "P-TANSTACK-",
    nuxt: "P-NUXT-",
    mastra: "P-MASTRA-",
    common: "P-COMMON-",
    braintrust: "P-BRAINTRUST-",
    langfuse: "P-LANGFUSE-",
}

const SEVERITY_AXES = {
    "User impact": new Set(["high", "med", "low"]),
    "Self-recoverable": new Set(["yes", "partially", "no"]),
    "Silent failure": new Set(["yes", "no"]),
}

function fail(msg) {
    console.error(`pain-log: ${msg}`)
}

function main() {
    if (!existsSync(LOG_PATH)) {
        fail(`pain-log.md not found at ${LOG_PATH}`)
        process.exit(2)
    }

    const text = readFileSync(LOG_PATH, "utf8")

    // Parse entries: each entry starts with `## P-...:` and runs until the
    // next `## ` heading (or end of file). The first heading-level-2 sections
    // before any `## P-` are the schema/numbering/done-signal sections — skip
    // those.
    const entryRegex = /^## (P-[A-Z-]+-\d+):\s*(.*)$/gm
    const matches = [...text.matchAll(entryRegex)]
    if (matches.length === 0) {
        // Empty log is a valid state (Phase 0 ships the log empty).
        return 0
    }

    let errors = 0
    const seenIds = new Set()

    for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        const id = m[1]
        const startIdx = m.index + m[0].length
        const endIdx = i + 1 < matches.length ? matches[i + 1].index : text.length
        const body = text.slice(startIdx, endIdx)

        // 1. Duplicate ID check.
        if (seenIds.has(id)) {
            fail(`duplicate entry ID: ${id}`)
            errors += 1
            continue
        }
        seenIds.add(id)

        // 2. Framework field present + valid.
        const fwMatch = body.match(/\*\*Framework:\*\*\s*([a-z-]+)/)
        if (!fwMatch) {
            fail(`${id}: missing or malformed **Framework:** line`)
            errors += 1
            continue
        }
        const framework = fwMatch[1]
        if (!KNOWN_FRAMEWORKS.has(framework)) {
            fail(`${id}: unknown framework "${framework}". Expected one of: ${[...KNOWN_FRAMEWORKS].join(", ")}`)
            errors += 1
            continue
        }

        // 3. ID prefix matches framework.
        const expectedPrefix = FRAMEWORK_PREFIX[framework]
        if (!id.startsWith(expectedPrefix)) {
            fail(`${id}: ID prefix doesn't match framework "${framework}". Expected prefix ${expectedPrefix}*`)
            errors += 1
        }

        // 4. Severity 3-axis check.
        for (const [axis, validValues] of Object.entries(SEVERITY_AXES)) {
            const axisRegex = new RegExp(`-\\s*${axis}:\\s*<?([a-z]+)>?`)
            const axisMatch = body.match(axisRegex)
            if (!axisMatch) {
                fail(`${id}: severity axis "${axis}" not found`)
                errors += 1
                continue
            }
            const value = axisMatch[1]
            if (!validValues.has(value)) {
                fail(`${id}: severity axis "${axis}" has invalid value "${value}". Expected: ${[...validValues].join(", ")}`)
                errors += 1
            }
        }

        // 5. At least 2 code blocks (friction + ideal sketch).
        const codeBlockCount = (body.match(/```(?:[a-z]*)?\n/g) || []).length / 2
        if (codeBlockCount < 2) {
            fail(`${id}: needs both a friction code block and an ideal sketch (found ${codeBlockCount} block(s))`)
            errors += 1
        }
    }

    if (errors > 0) {
        fail(`${errors} validation error(s) across ${matches.length} entries.`)
        process.exit(1)
    }

    console.log(`pain-log: ${matches.length} entries, all valid.`)
    return 0
}

main()
