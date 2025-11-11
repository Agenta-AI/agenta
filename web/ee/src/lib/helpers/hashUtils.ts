// Utility to generate a hash ID for annotation/invocation steps, aligned with backend make_hash_id
// Uses blake2b if available, otherwise falls back to SHA-256

import blake from "blakejs"
// import { v4 as uuidv4 } from "uuid" // Use this for UUIDs if needed

const REFERENCE_KEYS = [
    "application",
    "application_variant",
    "application_revision",
    "testset",
    "testcase",
    "evaluator",
]

// Recursively stable, whitespace-free JSON stringifier
function stableStringifyRecursive(obj: any): string {
    if (obj === null || typeof obj !== "object") {
        return JSON.stringify(obj)
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(stableStringifyRecursive).join(",")}]`
    }
    const keys = Object.keys(obj).sort()
    const entries = keys.map(
        (key) => `${JSON.stringify(key)}:${stableStringifyRecursive(obj[key])}`,
    )
    return `{${entries.join(",")}}`
}

export function makeHashId({
    references,
    links,
}: {
    references?: Record<string, {id?: string; slug?: string}>
    links?: Record<string, {span_id?: string; trace_id?: string}>
}): string {
    if (!references && !links) return ""
    const payload: Record<string, any> = {}

    for (const k of Object.keys(references || {})) {
        if (REFERENCE_KEYS.includes(k)) {
            const v = references![k]
            // Only include 'id' field, not 'slug'
            if (v.id != null) {
                payload[k] = {id: v.id}
            }
        }
    }
    for (const k of Object.keys(links || {})) {
        const v = links![k]
        payload[k] = {
            span_id: v.span_id,
            trace_id: v.trace_id,
        }
    }
    // Stable, deep, whitespace-free JSON
    const serialized = stableStringifyRecursive(payload)

    // blake2b hash (digest_size=16)
    try {
        // Use blakejs (same as backend example)
        return blake.blake2bHex(serialized, null, 16)
    } catch (e) {
        // Fallback: SHA-256
        if (window.crypto?.subtle) {
            throw new Error(
                "blake2b not available and crypto.subtle is async. Provide a polyfill or use a sync fallback.",
            )
        }
        return btoa(serialized)
    }
}
