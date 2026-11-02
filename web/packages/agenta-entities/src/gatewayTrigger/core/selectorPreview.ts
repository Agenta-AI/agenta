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
    const tokens = selectorPath(selector)
    return tokens ? walk(data, tokens) : undefined
}

// One step of a `$` path: `.name`, `[0]`, `["quoted key"]` or `['quoted key']`.
const PATH_STEP_RE = /\.([^.[\]]+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]|\['([^']*)'\]/y

/** The keys a selector walks, in order; a quoted key stays whole. Null when unreadable. */
export function selectorPath(selector: string): string[] | null {
    if (selector === "$") return []
    if (selector.startsWith("/")) {
        return selector
            .split("/")
            .slice(1)
            .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
    }
    if (!selector.startsWith("$")) return null
    const tokens: string[] = []
    PATH_STEP_RE.lastIndex = 1
    while (PATH_STEP_RE.lastIndex < selector.length) {
        const m = PATH_STEP_RE.exec(selector)
        if (!m) return null
        if (m[3] !== undefined) {
            try {
                tokens.push(JSON.parse(`"${m[3]}"`) as string)
            } catch {
                return null
            }
        } else {
            tokens.push(m[1] ?? m[2] ?? m[4] ?? "")
        }
    }
    return tokens
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
