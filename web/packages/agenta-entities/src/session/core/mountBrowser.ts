/**
 * Mount file browser derivation.
 *
 * The mounts API lists the WHOLE tree under a mount prefix as a flat array of relative paths
 * (`get_mount_files` → `MountFile[]`, no server-side one-level delimiter). This folds that flat
 * listing into the immediate children of a given directory — the one-level view a file browser
 * renders — so drilling into a folder is a pure re-derivation (change `currentPath`), not a refetch.
 */
import type {MountFile} from "./schema"

export interface MountRow {
    /** Display name — the single path segment at this level. */
    name: string
    /** Full mount-relative path (what to pass back as `currentPath` on drill-in, or `read`). */
    path: string
    isFolder: boolean
    /** File size in bytes; undefined for folders. */
    size?: number
}

/** Normalize a directory path: no leading/trailing slash; `""` is the mount root. */
const normalizeDir = (path: string | undefined): string => (path ?? "").replace(/^\/+|\/+$/g, "")

/**
 * The immediate children (folders + files) of `currentPath` within a flat mount listing.
 *
 * A folder is surfaced either by an explicit `is_folder` entry or implied by any deeper file path;
 * both dedupe to one row. Folders sort before files, each alphabetically (case-insensitive).
 */
export function deriveMountRows(files: MountFile[], currentPath = ""): MountRow[] {
    const dir = normalizeDir(currentPath)
    const prefix = dir ? `${dir}/` : ""

    const folders = new Map<string, MountRow>()
    const leaves = new Map<string, MountRow>()

    for (const file of files) {
        const full = normalizeDir(file.path)
        if (!full || !full.startsWith(prefix)) continue
        const rel = full.slice(prefix.length)
        if (!rel) continue // the directory entry itself

        const slash = rel.indexOf("/")
        if (slash === -1) {
            // Direct child at this level: a file, or an explicit empty-folder marker.
            const path = prefix + rel
            if (file.is_folder) {
                if (!folders.has(path)) folders.set(path, {name: rel, path, isFolder: true})
            } else {
                leaves.set(path, {
                    name: rel,
                    path,
                    isFolder: false,
                    size: file.size ?? undefined,
                })
            }
        } else {
            // Deeper path → its first segment is a folder at this level.
            const name = rel.slice(0, slash)
            const path = prefix + name
            if (!folders.has(path)) folders.set(path, {name, path, isFolder: true})
        }
    }

    const byName = (a: MountRow, b: MountRow) =>
        a.name.localeCompare(b.name, undefined, {sensitivity: "base"})
    return [...folders.values()].sort(byName).concat([...leaves.values()].sort(byName))
}

/** Breadcrumb segments for a directory path, each with its cumulative path (root first). */
export function mountBreadcrumbs(currentPath = ""): {name: string; path: string}[] {
    const dir = normalizeDir(currentPath)
    if (!dir) return []
    const parts = dir.split("/")
    return parts.map((name, i) => ({name, path: parts.slice(0, i + 1).join("/")}))
}
