import {constructPlaygroundTestUrl} from "./stringUtils"
import type {EnhancedVariant} from "./transformer/types"
import type {OpenAPISpec} from "./types/openapi"

export function getRequestSchema(
    spec: OpenAPISpec | undefined,
    opts: {variant?: EnhancedVariant; routePath?: string},
): any | undefined {
    if (!spec) return undefined
    const routePath = opts.routePath ?? (opts.variant as any)?.routePath

    // Prefer endpoints that typically include rich ag_config definitions.
    // Fallback order mirrors common LLM app patterns.
    const candidates = ["/run", "/test", "/generate", "/generate_deployed"] as const

    // First pass: pick the first schema that exposes ag_config
    for (const endpoint of candidates) {
        const p = constructPlaygroundTestUrl({routePath}, endpoint, false)
        const s = spec?.paths?.[p]?.post?.requestBody?.content?.["application/json"]?.schema
        if (s && typeof s === "object" && (s as any)?.properties?.ag_config) {
            return s
        }
    }

    // Second pass: return the first available request schema
    for (const endpoint of candidates) {
        const p = constructPlaygroundTestUrl({routePath}, endpoint, false)
        const s = spec?.paths?.[p]?.post?.requestBody?.content?.["application/json"]?.schema
        if (s) return s
    }

    return undefined
}
