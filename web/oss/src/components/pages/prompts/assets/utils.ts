import type {Folder} from "@/oss/services/folders/types"

import type {PromptsWorkflowRow} from "../store"

/**
 * Tree leaf for a workflow app
 */
export interface AppTreeNode extends PromptsWorkflowRow {
    type: "app"
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

export const buildFolderTree = (
    folders: Folder[],
    workflows: PromptsWorkflowRow[] = [],
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
        const parentId = node.parent_id ?? undefined

        if (parentId && foldersById[parentId]) {
            foldersById[parentId].children.push(node)
        } else {
            roots.push(node)
        }
    }

    // 3) Attach workflows as tree leaves
    for (const workflow of workflows) {
        const appNode: AppTreeNode = {
            ...workflow,
            type: "app",
        }

        const folderId = workflow.folderId
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
