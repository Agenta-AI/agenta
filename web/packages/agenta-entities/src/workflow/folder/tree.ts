/**
 * Pure helpers for the prompt folder tree: what a folder shows, how search narrows it, and which
 * moves are allowed. No React and no requests.
 */
import type {Folder} from "./schema"

/** The fields of a prompt the tree reads. */
export interface FolderPrompt {
    id: string
    name?: string | null
    folder_id?: string | null
    created_at?: string | null
    updated_at?: string | null
}

export type FolderTreeNode<P extends FolderPrompt = FolderPrompt> =
    | {kind: "folder"; id: string; folder: Folder; children: FolderTreeNode<P>[]}
    | {kind: "prompt"; id: string; prompt: P}

export type FoldersById = ReadonlyMap<string, Folder>

export const indexFolders = (folders: readonly Folder[]): Map<string, Folder> =>
    new Map(folders.map((folder) => [folder.id, folder]))

/**
 * The folder slug the API stores for a name. It keeps letters and digits from any language:
 * the API accepts them in names, and an ASCII-only rule left "Données" as "donnes" and a name
 * in another script empty.
 */
export const folderSlug = (name: string): string =>
    name
        .toLowerCase()
        .trim()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")

const byNewest = (a: FolderPrompt, b: FolderPrompt) => {
    const left = a.created_at ?? a.updated_at ?? ""
    const right = b.created_at ?? b.updated_at ?? ""
    if (left !== right) return left < right ? 1 : -1
    return a.id < b.id ? 1 : -1
}

const byName = (a: Folder, b: Folder) => (a.name ?? "").localeCompare(b.name ?? "")

/**
 * The folder a prompt belongs to. A prompt whose folder is not in the list sits at the root:
 * the server deletes a folder with all its subfolders and leaves their prompts with a stale
 * folder id, so reading that id as a place would hide them.
 */
const promptFolderId = (prompt: FolderPrompt, foldersById: FoldersById): string | null =>
    prompt.folder_id && foldersById.has(prompt.folder_id) ? prompt.folder_id : null

/** What a folder holds, or the root when `folderId` is `null`: subfolders first (API order), then prompts newest first. */
export const browseRows = <P extends FolderPrompt>({
    folders,
    prompts,
    folderId,
}: {
    folders: readonly Folder[]
    prompts: readonly P[]
    folderId: string | null
}): FolderTreeNode<P>[] => {
    const foldersById = indexFolders(folders)
    const parentOf = (folder: Folder) =>
        folder.parent_id && foldersById.has(folder.parent_id) ? folder.parent_id : null
    const subfolders = folders
        .filter((folder) => parentOf(folder) === folderId)
        .map((folder): FolderTreeNode<P> => ({kind: "folder", id: folder.id, folder, children: []}))
    const here = prompts
        .filter((prompt) => promptFolderId(prompt, foldersById) === folderId)
        .sort(byNewest)
        .map((prompt): FolderTreeNode<P> => ({kind: "prompt", id: prompt.id, prompt}))
    return [...subfolders, ...here]
}

/** The whole project as a tree: folders in API order, prompts newest first, orphans at the root. */
export const buildFolderTree = <P extends FolderPrompt>(
    folders: readonly Folder[],
    prompts: readonly P[],
): FolderTreeNode<P>[] => {
    const build = (folderId: string | null): FolderTreeNode<P>[] =>
        browseRows({folders, prompts, folderId}).map((node) =>
            node.kind === "folder" ? {...node, children: build(node.id)} : node,
        )
    return build(null)
}

/** The folders from the root down to `id`. Empty for the root or an unknown id. */
export const folderChain = (foldersById: FoldersById, id: string | null): Folder[] => {
    const chain: Folder[] = []
    const seen = new Set<string>()
    let current = id ? foldersById.get(id) : undefined
    while (current && !seen.has(current.id)) {
        seen.add(current.id)
        chain.unshift(current)
        current = current.parent_id ? foldersById.get(current.parent_id) : undefined
    }
    return chain
}

/** The folders that share a parent (`null` for the root level), sorted by name. */
export const siblingFolders = (foldersById: FoldersById, parentId: string | null): Folder[] =>
    [...foldersById.values()]
        .filter((folder) => (folder.parent_id ?? null) === parentId)
        .sort(byName)

const nodeName = (node: FolderTreeNode): string =>
    (node.kind === "folder" ? node.folder.name : node.prompt.name) ?? ""

/** Keeps the items whose name contains the term, with the folders above them. Case insensitive. */
export const filterTreeBySearch = <P extends FolderPrompt>(
    roots: readonly FolderTreeNode<P>[],
    term: string,
): FolderTreeNode<P>[] => {
    const needle = term.trim().toLowerCase()
    if (!needle) return [...roots]
    const keep = (nodes: readonly FolderTreeNode<P>[]): FolderTreeNode<P>[] =>
        nodes.flatMap((node): FolderTreeNode<P>[] => {
            const matches = nodeName(node).toLowerCase().includes(needle)
            if (node.kind === "prompt") return matches ? [node] : []
            const children = keep(node.children)
            return matches || children.length > 0 ? [{...node, children}] : []
        })
    return keep(roots)
}

export type MoveItem =
    | {kind: "folder"; id: string}
    | {kind: "prompt"; id: string; folderId: string | null}

/**
 * Whether the item may go into the destination. There is no root destination: the API drops a
 * null folder id. A folder cannot go into itself or a folder below it, and nothing goes where it
 * already is.
 */
export const isValidMoveTarget = ({
    foldersById,
    item,
    destinationId,
}: {
    foldersById: FoldersById
    item: MoveItem
    destinationId: string | null
}): boolean => {
    if (!destinationId || !foldersById.has(destinationId)) return false
    if (item.kind === "prompt") return item.folderId !== destinationId
    if (destinationId === item.id) return false
    if (folderChain(foldersById, destinationId).some((folder) => folder.id === item.id)) {
        return false
    }
    return (foldersById.get(item.id)?.parent_id ?? null) !== destinationId
}

/** The path shown while a folder is named: the stored slug of each ancestor, then the new slug. */
export const folderPathPreview = (
    foldersById: FoldersById,
    parentId: string | null,
    name: string,
): string =>
    [...folderChain(foldersById, parentId).map((folder) => folder.slug ?? ""), folderSlug(name)]
        .filter(Boolean)
        .join("/")
