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

const cleanPath = (p: string): string => p.replace(/^\/+|\/+$/g, "")
const hasExtension = (name: string): boolean => /\.[^./]+$/.test(name)

/**
 * Is this listing entry a FOLDER rather than a file? True when the backend flags it (`is_folder`),
 * when another entry nests under it (`<path>/…`), or when it's a zero-byte, extension-less entry —
 * the shape an agent's convention directory (e.g. `agent-files`) takes when the object store lists
 * it as a bare 0-byte key with no trailing-slash folder marker (so the backend can't flag it). We
 * infer it here so folders never leak into the flat file/recents lists (which show files, descending
 * INTO folders) and render as folders in the tree instead of a spurious 0 B "file".
 */
export const isFolderEntry = (file: MountFile, all: MountFile[]): boolean => {
    if (file.is_folder) return true
    const self = cleanPath(file.path)
    if (!self) return false
    if (all.some((o) => o !== file && cleanPath(o.path).startsWith(`${self}/`))) return true
    return (file.size ?? 0) === 0 && !hasExtension(self.split("/").pop() ?? self)
}

/** Non-folder entries only — the "n files" everywhere counts these. Folders (flagged or inferred)
 * are excluded so the flat lists show files, descending into folders. */
export const driveFiles = (files: MountFile[] | null | undefined): MountFile[] => {
    const list = files ?? []
    return list.filter((f) => !isFolderEntry(f, list))
}

export const driveTotalSize = (files: MountFile[] | null | undefined): number =>
    driveFiles(files).reduce((sum, f) => sum + (f.size ?? 0), 0)

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
    for (const file of list) {
        const path = file.path.replace(/^\/+|\/+$/g, "")
        if (!path) continue
        if (isFolderEntry(file, list)) {
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
