#!/usr/bin/env node
/**
 * Post-process the openapi-zod-client output for Zod 4 + our SDK conventions:
 *
 *   1. Strip the @zodios/core import + `endpoints` array + `api` exports — we
 *      don't use Zodios; we have our own AgentaClient.
 *   2. Rewrite single-arg `z.record(X)` to two-arg `z.record(z.string(), X)`
 *      because Zod 4 made the key type required.
 *   3. Drop unused legacy type aliases (we keep only the schema definitions).
 */

import {readFileSync, writeFileSync} from "node:fs"

const inputPath = process.argv[2]
const outputPath = process.argv[3]

if (!inputPath || !outputPath) {
    console.error("Usage: postprocess.mjs <input> <output>")
    process.exit(1)
}

const src = readFileSync(inputPath, "utf-8")

// ─── 1. Strip the Zodios bits ───────────────────────────────────────────────
// Replace the import with a Zod-only import. Drop everything from the
// `const endpoints = makeApi([` line onward.
let body = src.replace(
    /^import \{ makeApi, Zodios, type ZodiosOptions \} from "@zodios\/core";\n/m,
    "",
)

const endpointsIdx = body.indexOf("const endpoints = makeApi(")
if (endpointsIdx > 0) {
    body = body.slice(0, endpointsIdx).trimEnd() + "\n"
}

// ─── 2. Rewrite z.record(X) → z.record(z.string(), X) ───────────────────────
// Need balanced-paren matching since X can contain nested z.record(...) calls.
// Need to match both `z.record(` and the multi-line `z\n  .record(` form
// (prettier breaks long expressions across lines). We rewrite recursively:
// process the inner argument before reconstructing the outer wrapper.
function rewriteRecordCalls(text) {
    // Match `z.record(` or `z\s+.record(` (handles formatter line breaks).
    // We don't bother with `Z.record(` etc.; only the literal `z` namespace.
    const re = /\bz\s*\.\s*record\s*\(/g
    const out = []
    let cursor = 0
    let m
    while ((m = re.exec(text)) !== null) {
        const matchStart = m.index
        const innerStart = m.index + m[0].length
        out.push(text.slice(cursor, matchStart))
        let i = innerStart
        let depth = 1
        while (i < text.length && depth > 0) {
            const c = text[i]
            if (c === "(") depth++
            else if (c === ")") depth--
            if (depth > 0) i++
        }
        if (depth !== 0) {
            // Unbalanced; bail safely
            out.push(text.slice(matchStart))
            cursor = text.length
            break
        }
        // i points at the closing ')'.
        const inner = text.slice(innerStart, i)
        const rewrittenInner = rewriteRecordCalls(inner)
        const looksTwoArg = (() => {
            let d = 0
            for (const c of rewrittenInner) {
                if (c === "(") d++
                else if (c === ")") d--
                else if (c === "," && d === 0) return true
            }
            return false
        })()
        out.push(
            looksTwoArg
                ? `z.record(${rewrittenInner})`
                : `z.record(z.string(), ${rewrittenInner})`,
        )
        cursor = i + 1
        re.lastIndex = cursor
    }
    out.push(text.slice(cursor))
    return out.join("")
}

body = rewriteRecordCalls(body)

// ─── 3. Header note ─────────────────────────────────────────────────────────
const header = `/* eslint-disable */
// AUTO-GENERATED — DO NOT EDIT
//
// Source: backend OpenAPI spec (https://cloud.agenta.ai/api/openapi.json)
// Generator: openapi-zod-client + post-processor (rewrites z.record arity for Zod 4,
// strips the Zodios runtime since we use AgentaClient).
//
// Regenerate with: pnpm generate:schemas
//
// Each schema ends with .passthrough() to mirror the backend's
// Pydantic.extra="allow" config — unknown fields don't trigger validation
// errors, they just pass through unchanged.

`

writeFileSync(outputPath, header + body)
console.error(`Wrote ${outputPath}`)
