/**
 * Rows for the composer's `@` file palette, derived from a flat drive listing.
 *
 * Pure and React-free: the palette wants a short, flat, capped list per state, so it derives one
 * directly rather than building the explorer's tree and flattening it back down.
 */
import {cleanPath, isListableDrivePath, type DriveRecentFile} from "@agenta/entities/drive"
import type {MountFile} from "@agenta/entities/session"

/** Enough rows to scroll through, few enough that a 12k-file drive never renders 12k of them. */
export const FILE_PALETTE_ROW_CAP = 30
export const FILE_PALETTE_RECENTS = 5

export interface PaletteFileRow {
    /** The presented drive path — what gets referenced, `agent-files/` fold included. */
    path: string
    name: string
    isFolder: boolean
    size?: number
    itemCount?: number
    touchedAt?: number
}

const prefixFor = (cwd: string): string => {
    const rel = cleanPath(cwd)
    return rel ? `${rel}/` : ""
}

const basename = (path: string): string => path.split("/").pop() ?? path

/** Folders above files, then alphabetical — the order every drive surface lists in. */
const byFolderThenName = (a: PaletteFileRow, b: PaletteFileRow): number =>
    Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name)

const rowFor = (file: MountFile, path: string, isFolder: boolean): PaletteFileRow => ({
    path,
    name: basename(path),
    isFolder,
    size: isFolder ? undefined : (file.size ?? undefined),
    itemCount: file.item_count ?? undefined,
})

/**
 * The immediate children of `cwd`. A listing may hold deeper entries (every loaded directory
 * accumulates into one array), so a path that reaches further down contributes its next segment as
 * an implied folder rather than a row of its own.
 */
export function browseRows(files: MountFile[], cwd: string): PaletteFileRow[] {
    const prefix = prefixFor(cwd)
    const rows = new Map<string, PaletteFileRow>()
    for (const file of files) {
        const rel = cleanPath(file.path)
        if (!rel.startsWith(prefix)) continue
        const rest = rel.slice(prefix.length)
        if (!rest) continue
        // Judge the LISTING entry, not the folder it implies: the bare `agent-files` marker is
        // unlistable, but the agent files under it fold into a folder that very much is.
        if (!isListableDrivePath(rel)) continue
        const cut = rest.indexOf("/")
        const path = cut < 0 ? rel : prefix + rest.slice(0, cut)
        const isFolder = cut >= 0 || Boolean(file.is_folder)
        // An implied folder must not inherit the descendant's size or count.
        const existing = rows.get(path)
        if (existing && (existing.isFolder || !isFolder)) continue
        rows.set(
            path,
            cut < 0 ? rowFor(file, path, isFolder) : {path, name: basename(path), isFolder: true},
        )
    }
    return [...rows.values()].sort(byFolderThenName)
}

/**
 * Everything under `cwd` whose path contains `query`. Plain case-insensitive substring on the full
 * path — the palette highlights the match by re-deriving it from the row's label, so a looser
 * predicate here returns rows that come back matched but unhighlighted.
 */
export function searchRows(
    files: MountFile[],
    cwd: string,
    query: string,
    cap: number = FILE_PALETTE_ROW_CAP,
): PaletteFileRow[] {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const prefix = prefixFor(cwd)
    const rows: PaletteFileRow[] = []
    for (const file of files) {
        const rel = cleanPath(file.path)
        if (!rel.startsWith(prefix) || !isListableDrivePath(rel)) continue
        if (!rel.toLowerCase().includes(q)) continue
        rows.push(rowFor(file, rel, Boolean(file.is_folder)))
    }
    return rows.sort(byFolderThenName).slice(0, cap)
}

/** The drive's most-recently-touched files, for the palette's opening list. */
export function recentRows(
    recents: DriveRecentFile[],
    limit: number = FILE_PALETTE_RECENTS,
): PaletteFileRow[] {
    const rows: PaletteFileRow[] = []
    for (const file of recents) {
        if (rows.length >= limit) break
        const rel = cleanPath(file.path)
        if (!isListableDrivePath(rel) || file.is_folder) continue
        rows.push({...rowFor(file, rel, false), touchedAt: file.touchedAt})
    }
    return rows
}

/** The directory a path sits in, as a presented drive path (`""` at the root). */
export const parentPath = (path: string): string => {
    const rel = cleanPath(path)
    const cut = rel.lastIndexOf("/")
    return cut < 0 ? "" : rel.slice(0, cut)
}
