import {Folder} from "@/oss/services/folders/types"

export interface FolderTreeNode extends Folder {
    children: FolderTreeNode[]
}

export const buildFolderTree = (
    folders: Folder[],
): {roots: FolderTreeNode[]; foldersById: Record<string, FolderTreeNode>} => {
    const foldersById: Record<string, FolderTreeNode> = {}

    // first pass
    for (const folder of folders) {
        foldersById[folder.id!] = {
            ...folder,
            children: [],
        }
    }

    const roots: FolderTreeNode[] = []

    // second pass: hook up parents
    for (const node of Object.values(foldersById)) {
        const parentId = (node as any).parent_id as string | undefined
        if (parentId && foldersById[parentId]) {
            foldersById[parentId].children.push(node)
        } else {
            roots.push(node)
        }
    }

    return {roots, foldersById}
}

export const slugify = (value: string) =>
    value
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
