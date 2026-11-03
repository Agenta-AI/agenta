/**
 * Agent HTML apps — path scoping (lane A).
 *
 * Every path the app hands the bridge is relative to its own folder. The host turns it into the
 * mount-relative path the API wants, and refuses anything that could leave the folder.
 *
 * {@link normalizeAppPath} is the rule, and it lives here rather than in the mock host because it
 * is the check that keeps an app inside its folder: production must not import it from a test
 * double. The mock imports it from this module so both sides are provably the same rule.
 */

export interface ScopeFailure {
    code: "scope"
    message: string
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/

/**
 * Normalise an app-relative path. Returns null when the path is out of scope: absolute, empty,
 * backslashes, control characters, `.`/`..` segments (also percent-encoded), empty segments.
 * `list` alone may pass `""` to mean the app dir itself.
 */
export function normalizeAppPath(raw: string, opts?: {allowRoot?: boolean}): string | null {
    if (typeof raw !== "string") return null
    let decoded: string
    try {
        decoded = decodeURIComponent(raw)
    } catch {
        return null
    }
    if (decoded === "") return opts?.allowRoot ? "" : null
    if (decoded.startsWith("/")) return null
    if (decoded.includes("\\")) return null
    if (CONTROL_CHARS.test(decoded)) return null
    const trimmed = decoded.endsWith("/") ? decoded.slice(0, -1) : decoded
    if (trimmed === "") return null
    const segments = trimmed.split("/")
    for (const segment of segments) {
        if (segment === "" || segment === "." || segment === "..") return null
    }
    return segments.join("/")
}

export const SCOPE_MESSAGE = "path is outside the app directory"

export const isScopeFailure = (x: unknown): x is ScopeFailure =>
    typeof x === "object" && x !== null && (x as ScopeFailure).code === "scope"

/** Strip leading/trailing slashes from the app dir so joins are predictable (`""` = mount root). */
export function normalizeAppDir(dir: string): string {
    let start = 0
    let end = dir.length
    while (start < end && dir[start] === "/") start++
    while (end > start && dir[end - 1] === "/") end--
    return dir.slice(start, end)
}

/** `dir` + app-relative path → mount-relative path. `""` (root) only when `allowRoot`. */
export function joinAppPath(dir: string, relative: string): string {
    const base = normalizeAppDir(dir)
    if (relative === "") return base
    return base === "" ? relative : `${base}/${relative}`
}

/**
 * Resolve an app-relative path against the app dir. Returns the mount-relative path, or a
 * `scope` failure when the path is out of scope. `list` may pass `""` (with `allowRoot`) to
 * mean the app dir itself.
 */
export function resolveScoped(
    dir: string,
    path: string,
    opts?: {allowRoot?: boolean},
): string | ScopeFailure {
    const relative = normalizeAppPath(path, opts)
    if (relative === null) return {code: "scope", message: SCOPE_MESSAGE}
    return joinAppPath(dir, relative)
}

/**
 * Mount-relative path (as the API reports it) → app-relative path. Returns null when the path
 * is not under `dir`, so a listing can drop entries that somehow escaped the folder.
 */
export function toAppRelative(dir: string, fullPath: string): string | null {
    const base = normalizeAppDir(dir)
    const clean = fullPath.replace(/^\/+/, "")
    if (base === "") return clean
    if (clean === base) return ""
    const prefix = `${base}/`
    return clean.startsWith(prefix) ? clean.slice(prefix.length) : null
}
