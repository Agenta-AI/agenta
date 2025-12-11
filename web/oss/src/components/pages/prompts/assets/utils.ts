import {ListAppsItem} from "@/oss/lib/Types"
import {Folder} from "@/oss/services/folders/types"

/**
 * Tree leaf for an app
 */
export interface AppTreeNode extends ListAppsItem {
    type: "app"
    folder_id?: string | null
}

/**
 * Tree node for a folder; children can be folders or apps.
 */
export interface FolderTreeNode extends Folder {
    type: "folder"
    children: FolderTreeItem[]
}

/**
 * Generic tree item (folder or app).
 */
export type FolderTreeItem = FolderTreeNode | AppTreeNode

export const ROOT_TREE_KEY = "__ROOT__"

export const buildFolderTree = (
    folders: Folder[],
    apps: ListAppsItem[] = [],
): {
    roots: FolderTreeItem[]
    foldersById: Record<string, FolderTreeNode>
} => {
    const foldersById: Record<string, FolderTreeNode> = {}

    // 1) Build folder nodes with children arrays internally
    for (const folder of folders) {
        foldersById[folder.id!] = {
            ...folder,
            type: "folder",
            children: [],
        }
    }

    const roots: FolderTreeItem[] = []

    // 2) Hook up folder parents
    for (const node of Object.values(foldersById)) {
        const parentId = (node as any).parent_id as string | undefined

        if (parentId && foldersById[parentId]) {
            foldersById[parentId].children.push(node)
        } else {
            roots.push(node)
        }
    }

    // 3) Attach apps as tree leaves
    for (const app of apps) {
        const appNode: AppTreeNode = {
            ...app,
            type: "app",
        }

        const folderId = (app as any).folder_id ?? null
        if (folderId && foldersById[folderId]) {
            foldersById[folderId].children.push(appNode)
        } else {
            roots.push(appNode)
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
