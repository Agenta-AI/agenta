/**
 * Selector resolution for the subscription mapping preview.
 *
 * A subscription maps workflow inputs from the event context via selectors:
 * JSONPath-lite (`$.a.b[0]`, `$["a"]["b"]`) or JSON Pointer (`/a/b/0`). The
 * drawer resolves them against a sample context to preview what each field
 * would receive. Dependency-free and best-effort: an unresolved selector yields
 * `undefined` rather than throwing. The backend remains the source of truth.
 */

/** Render a resolved value for display. */
export function previewValue(value: unknown): string {
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

/** Best-effort resolution of `$.a.b[0]` / `$["a"]["b"]` / `/a/b/0`. */
export function resolveSelectorPreview(selector: string, data: Record<string, unknown>): unknown {
    try {
        if (selector === "$") return data
        if (selector.startsWith("/")) {
            const tokens = selector
                .split("/")
                .slice(1)
                .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
            return walk(data, tokens)
        }
        if (selector.startsWith("$")) {
            const tokens = selector
                .slice(1)
                .replace(/\[(\d+)\]/g, ".$1")
                .replace(/\[["'](.*?)["']\]/g, ".$1")
                .split(".")
                .filter((t) => t.length > 0)
            return walk(data, tokens)
        }
    } catch {
        return undefined
    }
    return undefined
}

function walk(data: unknown, tokens: string[]): unknown {
    let cur: unknown = data
    for (const token of tokens) {
        if (cur == null) return undefined
        if (Array.isArray(cur)) {
            const idx = Number(token)
            if (!Number.isInteger(idx)) return undefined
            cur = cur[idx]
        } else if (typeof cur === "object") {
            cur = (cur as Record<string, unknown>)[token]
        } else {
            return undefined
        }
    }
    return cur
}
