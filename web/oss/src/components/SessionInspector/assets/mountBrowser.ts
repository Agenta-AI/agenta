import type {MountFileEntry} from "../api"

export interface FolderRow {
    kind: "folder"
    name: string
    path: string
}

export interface FileRow {
    kind: "file"
    name: string
    entry: MountFileEntry
}

export type BrowserRow = FolderRow | FileRow

/**
 * The API lists a path's subtree recursively and flat, with every entry's `path` relative
 * to the mount root. Derive a one-level (folder, file) view for `currentPath` client-side:
 * a further `/` past the current prefix means the entry belongs to a subfolder, so it
 * contributes a synthetic folder row for its first segment instead of a file row. Explicit
 * `is_folder` marker rows for a direct child folder are merged into the same synthetic set
 * so a folder never appears twice.
 */
export const deriveRows = (files: MountFileEntry[], currentPath: string): BrowserRow[] => {
    const prefix = currentPath ? `${currentPath}/` : ""
    const folders = new Map<string, FolderRow>()
    const fileRows: FileRow[] = []

    for (const entry of files) {
        if (prefix && !entry.path.startsWith(prefix)) continue
        const relative = entry.path.slice(prefix.length)
        if (!relative) continue // marker entry for the current path itself

        const isMarker = entry.is_folder || relative.endsWith("/")
        const cleanRelative = relative.endsWith("/") ? relative.slice(0, -1) : relative
        if (!cleanRelative) continue

        const slashIdx = cleanRelative.indexOf("/")
        if (slashIdx === -1) {
            if (isMarker) {
                if (!folders.has(cleanRelative)) {
                    folders.set(cleanRelative, {
                        kind: "folder",
                        name: cleanRelative,
                        path: prefix + cleanRelative,
                    })
                }
            } else {
                fileRows.push({kind: "file", name: cleanRelative, entry})
            }
        } else {
            const segment = cleanRelative.slice(0, slashIdx)
            if (!folders.has(segment)) {
                folders.set(segment, {kind: "folder", name: segment, path: prefix + segment})
            }
        }
    }

    const folderRows = Array.from(folders.values()).sort((a, b) => a.name.localeCompare(b.name))
    fileRows.sort((a, b) => a.name.localeCompare(b.name))
    return [...folderRows, ...fileRows]
}

/** Compact human size: `820 B`, `4.2 KB`. */
export const formatSize = (n: number): string => {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
