/**
 * Pure tree/format helpers for the drive surfaces (build-spec direction 1a).
 *
 * The backend lists the WHOLE tree flat (`MountFile[]`, paths relative to the drive root);
 * these helpers shape it for the UI: an expandable tree (folders first, alpha within), a
 * client-side path-substring filter, and the shared size/recency formatters.
 */
import type {MountFile} from "@agenta/entities/session"

export interface DriveTreeNode {
    name: string
    /** Drive-root-relative path. */
    path: string
    isFolder: boolean
    size?: number
    children: DriveTreeNode[]
}

/** Strip leading/trailing slashes via a single linear scan — NOT `/^\/+|\/+$/`, whose end-anchored
 * `\/+$` backtracks quadratically on backend-supplied paths with many '/' (CodeQL polynomial-ReDoS).
 * Internal slashes preserved. `47` is `"/".charCodeAt(0)`. */
export const cleanPath = (p: string): string => {
    let start = 0
    let end = p.length
    while (start < end && p.charCodeAt(start) === 47) start++
    while (end > start && p.charCodeAt(end - 1) === 47) end--
    return start === 0 && end === p.length ? p : p.slice(start, end)
}
const hasExtension = (name: string): boolean => /\.[^./]+$/.test(name)

/**
 * Runner/harness runtime artifacts written INTO the durable session cwd — not user files, so they're
 * hidden from every drive surface. Covers the whole runner-owned `agents/` namespace (Pi's transcript
 * workspace `agents/sessions/…` AND materialized skill definitions `agents/skills/…`) and the runner's
 * dot-markers (`.agenta-skill-set.json`, `.agenta-usage.json`, `.agenta-pi`, …). The agent's own folder
 * (`agent-files/`) is intentional and NOT matched — different prefix, so `startsWith("agents/")` misses it.
 */
export const isInternalDrivePath = (path: string): boolean => {
    const rel = cleanPath(path)
    if (!rel) return false
    if (rel === "agents" || rel.startsWith("agents/")) return true
    return rel.split("/").some((seg) => seg.startsWith(".agenta-"))
}

/** A dot-prefixed (hidden) file or folder anywhere in the path — surfaced but dimmed, the way a
 * file browser greys out `.git`, `.claude`, dotfiles. NOT the same as {@link isInternalDrivePath}
 * (which hides runner plumbing outright). */
export const isHiddenPath = (path: string): boolean =>
    cleanPath(path)
        .split("/")
        .some((seg) => seg.startsWith("."))

/**
 * The set of every path that is a strict ancestor DIRECTORY of some listing entry — i.e. every
 * `p` such that another entry's path is `p/…`. Precomputed ONCE per listing so folder inference is
 * an O(1) set lookup instead of an O(n) `all.some(startsWith)` rescan per entry (which made the
 * whole drive O(n²) and froze the main thread on large agent-written trees).
 */
export const buildFolderIndex = (files: MountFile[] | null | undefined): Set<string> => {
    const dirs = new Set<string>()
    for (const f of files ?? []) {
        const p = cleanPath(f.path)
        // Add each strict prefix directory of `p` (everything up to, not including, `p` itself).
        for (let slash = p.indexOf("/"); slash !== -1; slash = p.indexOf("/", slash + 1)) {
            dirs.add(p.slice(0, slash))
        }
    }
    return dirs
}

/**
 * Is this listing entry a FOLDER rather than a file? True when the backend flags it (`is_folder`),
 * when another entry nests under it (`folderIndex` holds its path), or when it's a zero-byte,
 * extension-less entry — the shape an agent's convention directory (e.g. `agent-files`) takes when
 * the object store lists it as a bare 0-byte key with no trailing-slash folder marker (so the
 * backend can't flag it). We infer it here so folders never leak into the flat file/recents lists
 * (which show files, descending INTO folders) and render as folders in the tree instead of a
 * spurious 0 B "file". Pass a {@link buildFolderIndex} set built once from the same listing.
 */
export const isFolderEntry = (file: MountFile, folderIndex: Set<string>): boolean => {
    if (file.is_folder) return true
    const self = cleanPath(file.path)
    if (!self) return false
    if (folderIndex.has(self)) return true
    return (file.size ?? 0) === 0 && !hasExtension(self.split("/").pop() ?? self)
}

export interface DriveFileStats {
    /** Non-folder, non-internal entries — the real user files. */
    files: MountFile[]
    /** Sum of `files` sizes. */
    totalSize: number
}

/** Filter a listing to real user files AND sum their sizes in a SINGLE O(n) pass sharing one
 * folder index. Callers that need both the list and the total should use this rather than calling
 * {@link driveFiles} and {@link driveTotalSize} separately (which would each rebuild the index). */
export const driveFileStats = (files: MountFile[] | null | undefined): DriveFileStats => {
    const list = files ?? []
    const folderIndex = buildFolderIndex(list)
    const out: MountFile[] = []
    let totalSize = 0
    for (const f of list) {
        if (isFolderEntry(f, folderIndex) || isInternalDrivePath(f.path)) continue
        out.push(f)
        totalSize += f.size ?? 0
    }
    return {files: out, totalSize}
}

/** Non-folder entries only — the "n files" everywhere counts these. Folders (flagged or inferred)
 * and runner-internal runtime artifacts are excluded so the flat lists show only real user files. */
export const driveFiles = (files: MountFile[] | null | undefined): MountFile[] =>
    driveFileStats(files).files

export const driveTotalSize = (files: MountFile[] | null | undefined): number =>
    driveFileStats(files).totalSize

export const humanSize = (bytes?: number | null): string => {
    if (bytes == null) return ""
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const relativeTime = (at?: number | null): string => {
    if (!at) return ""
    const s = Math.max(0, Math.round((Date.now() - at) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
}

export const isMarkdownPath = (path: string): boolean => /\.(md|markdown)$/i.test(path)

/**
 * Build the expandable tree from the flat listing: intermediate folders are materialized from
 * file paths (plus explicit `is_folder` rows), folders sort first, alpha within each level.
 */
export function buildDriveTree(files: MountFile[] | null | undefined): DriveTreeNode[] {
    const root: DriveTreeNode = {name: "", path: "", isFolder: true, children: []}
    const byPath = new Map<string, DriveTreeNode>([["", root]])

    const ensureFolder = (path: string): DriveTreeNode => {
        const existing = byPath.get(path)
        if (existing) return existing
        const idx = path.lastIndexOf("/")
        const parent = ensureFolder(idx === -1 ? "" : path.slice(0, idx))
        const node: DriveTreeNode = {
            name: path.slice(idx + 1),
            path,
            isFolder: true,
            children: [],
        }
        parent.children.push(node)
        byPath.set(path, node)
        return node
    }

    const list = files ?? []
    const folderIndex = buildFolderIndex(list)
    for (const file of list) {
        const path = cleanPath(file.path)
        if (!path || isInternalDrivePath(path)) continue
        if (isFolderEntry(file, folderIndex)) {
            ensureFolder(path)
            continue
        }
        const idx = path.lastIndexOf("/")
        const parent = ensureFolder(idx === -1 ? "" : path.slice(0, idx))
        parent.children.push({
            name: path.slice(idx + 1),
            path,
            isFolder: false,
            size: file.size ?? 0,
            children: [],
        })
    }

    const sortLevel = (nodes: DriveTreeNode[]) => {
        nodes.sort((a, b) =>
            a.isFolder === b.isFolder ? a.name.localeCompare(b.name) : a.isFolder ? -1 : 1,
        )
        for (const n of nodes) if (n.children.length) sortLevel(n.children)
    }
    sortLevel(root.children)
    return root.children
}

/** Case-insensitive path-substring filter; folders survive when any descendant matches. */
export function filterDriveTree(nodes: DriveTreeNode[], query: string): DriveTreeNode[] {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    const walk = (list: DriveTreeNode[]): DriveTreeNode[] =>
        list
            .map((node) => {
                if (!node.isFolder) {
                    return node.path.toLowerCase().includes(q) ? node : null
                }
                const children = walk(node.children)
                return children.length || node.path.toLowerCase().includes(q)
                    ? {...node, children}
                    : null
            })
            .filter((n): n is DriveTreeNode => Boolean(n))
    return walk(nodes)
}

/** Every ancestor folder path of a file path — for auto-expanding the tree to a selection. */
export const ancestorPaths = (path: string): string[] => {
    const parts = path.split("/").slice(0, -1)
    return parts.map((_, i) => parts.slice(0, i + 1).join("/"))
}
