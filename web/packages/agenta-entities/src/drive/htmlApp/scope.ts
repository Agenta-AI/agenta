/**
 * Agent HTML apps — path scoping (lane A).
 *
 * Every path the app hands the bridge is relative to its own folder. The host turns it into the
 * mount-relative path the API wants, and refuses anything that could leave the folder. The rules
 * are exactly `normalizeAppPath` from the mock host (absolute, `..`, `.`, backslashes, control
 * characters, percent-encoded dots, empty segments); this module only adds the join with `dir`
 * and the inverse mapping for paths the API returns.
 */

import {normalizeAppPath} from "./mockHost"

export interface ScopeFailure {
    code: "scope"
    message: string
}

export const SCOPE_MESSAGE = "path is outside the app directory"

export const isScopeFailure = (x: unknown): x is ScopeFailure =>
    typeof x === "object" && x !== null && (x as ScopeFailure).code === "scope"

/** Strip leading/trailing slashes from the app dir so joins are predictable (`""` = mount root). */
export function normalizeAppDir(dir: string): string {
    return dir.replace(/^\/+/, "").replace(/\/+$/, "")
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
