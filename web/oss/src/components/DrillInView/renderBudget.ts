export type RenderBudgetMode =
    | "json"
    | "yaml"
    | "decoded-json"
    | "beautified-json"
    | "text"
    | "markdown"

export type RenderValueType = "string" | "array" | "object" | "null" | "primitive"

export interface RenderStats {
    type: RenderValueType
    estimatedChars: number
    estimateExceeded: boolean
    arrayLength?: number
    objectKeyCount?: number
}

export const MAX_INLINE_STRING_CHARS = 8_000
export const MAX_AUTO_FORMAT_CHARS = 50_000
export const MAX_ARRAY_ITEMS = 20
export const MAX_OBJECT_KEYS = 50
export const PREVIEW_STRING_CHARS = 4_000

const ESTIMATE_STOP_CHARS = MAX_AUTO_FORMAT_CHARS + MAX_INLINE_STRING_CHARS
const PREVIEW_STRING_LEAF_CHARS = 800
const PREVIEW_OBJECT_KEYS = 12
const PREVIEW_ARRAY_ITEMS = 8
const PREVIEW_DEPTH = 3

function getValueType(value: unknown): RenderValueType {
    if (value === null || value === undefined) return "null"
    if (typeof value === "string") return "string"
    if (Array.isArray(value)) return "array"
    if (typeof value === "object") return "object"
    return "primitive"
}

function estimateChars(
    value: unknown,
    seen: WeakSet<object>,
    depth = 0,
): {chars: number; exceeded: boolean} {
    if (value === null || value === undefined) return {chars: 4, exceeded: false}

    if (typeof value === "string") {
        const chars = value.length + 2
        return {chars, exceeded: chars > ESTIMATE_STOP_CHARS}
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return {chars: String(value).length, exceeded: false}
    }

    if (typeof value !== "object") {
        return {chars: String(value).length, exceeded: false}
    }

    if (seen.has(value)) return {chars: 12, exceeded: false}
    seen.add(value)

    if (depth > 6) return {chars: 32, exceeded: false}

    let chars = Array.isArray(value) ? 2 : 2
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item] as const)
        : Object.entries(value as Record<string, unknown>)

    for (const [key, nested] of entries) {
        chars += key.length + 4
        const estimate = estimateChars(nested, seen, depth + 1)
        chars += estimate.chars + 1

        if (estimate.exceeded || chars > ESTIMATE_STOP_CHARS) {
            return {chars, exceeded: true}
        }
    }

    return {chars, exceeded: false}
}

export function getRenderStats(value: unknown): RenderStats {
    const type = getValueType(value)
    const estimate = estimateChars(value, new WeakSet())

    return {
        type,
        estimatedChars: estimate.chars,
        estimateExceeded: estimate.exceeded,
        arrayLength: Array.isArray(value) ? value.length : undefined,
        objectKeyCount:
            value && typeof value === "object" && !Array.isArray(value)
                ? Object.keys(value as Record<string, unknown>).length
                : undefined,
    }
}

export function shouldUsePreview(stats: RenderStats, mode: RenderBudgetMode): boolean {
    if (stats.type === "string" && stats.estimatedChars > MAX_INLINE_STRING_CHARS) return true
    if ((stats.arrayLength ?? 0) > MAX_ARRAY_ITEMS) return true
    if ((stats.objectKeyCount ?? 0) > MAX_OBJECT_KEYS) return true

    if (mode === "json" || mode === "yaml" || mode === "decoded-json") {
        return stats.estimateExceeded || stats.estimatedChars > MAX_AUTO_FORMAT_CHARS
    }

    return stats.estimateExceeded || stats.estimatedChars > MAX_AUTO_FORMAT_CHARS
}

export function truncateText(value: string, maxChars = PREVIEW_STRING_CHARS) {
    if (value.length <= maxChars) {
        return {text: value, isTruncated: false, hiddenChars: 0}
    }

    return {
        text: `${value.slice(0, maxChars)}…`,
        isTruncated: true,
        hiddenChars: value.length - maxChars,
    }
}

export function getPreviewItems(value: unknown) {
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ARRAY_ITEMS)
        return {
            items,
            hiddenCount: Math.max(0, value.length - items.length),
            kind: "array" as const,
        }
    }

    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
        const items = entries.slice(0, MAX_OBJECT_KEYS)
        return {
            items,
            hiddenCount: Math.max(0, entries.length - items.length),
            kind: "object" as const,
        }
    }

    return {items: [], hiddenCount: 0, kind: "none" as const}
}

function buildPreviewValue(value: unknown, depth = 0): unknown {
    if (typeof value === "string") {
        const truncated = truncateText(value, PREVIEW_STRING_LEAF_CHARS)
        return truncated.isTruncated
            ? `${truncated.text} (${truncated.hiddenChars} more chars)`
            : truncated.text
    }

    if (!value || typeof value !== "object") return value

    if (depth >= PREVIEW_DEPTH) {
        if (Array.isArray(value)) return `[Array(${value.length})]`
        return `[Object(${Object.keys(value as Record<string, unknown>).length})]`
    }

    if (Array.isArray(value)) {
        const preview = value
            .slice(0, PREVIEW_ARRAY_ITEMS)
            .map((item) => buildPreviewValue(item, depth + 1))
        if (value.length > PREVIEW_ARRAY_ITEMS) {
            preview.push(`... ${value.length - PREVIEW_ARRAY_ITEMS} more items`)
        }
        return preview
    }

    const entries = Object.entries(value as Record<string, unknown>)
    const preview: Record<string, unknown> = {}
    for (const [key, nested] of entries.slice(0, PREVIEW_OBJECT_KEYS)) {
        preview[key] = buildPreviewValue(nested, depth + 1)
    }
    if (entries.length > PREVIEW_OBJECT_KEYS) {
        preview.__truncated__ = `${entries.length - PREVIEW_OBJECT_KEYS} more keys`
    }
    return preview
}

export function previewValueString(value: unknown, maxChars = PREVIEW_STRING_CHARS): string {
    if (typeof value === "string") return truncateText(value, maxChars).text

    try {
        const preview = JSON.stringify(buildPreviewValue(value), null, 2) ?? ""
        return truncateText(preview, maxChars).text
    } catch {
        return truncateText(String(value), maxChars).text
    }
}

export function stringifyFullValue(value: unknown): string {
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2) ?? "null"
    } catch {
        return String(value)
    }
}

export function formatRenderSize(chars: number): string {
    if (chars < 1_000) return `${chars} chars`
    if (chars < 1_000_000) return `${Math.round(chars / 100) / 10} KB`
    return `${Math.round(chars / 100_000) / 10} MB`
}
