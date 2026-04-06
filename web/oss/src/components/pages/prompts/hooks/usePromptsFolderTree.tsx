import {useCallback, useMemo} from "react"

import {FolderOpenOutlined} from "@ant-design/icons"
import {DataNode} from "antd/es/tree"

import type {Folder} from "@/oss/services/folders/types"

import {getAppTypeIcon} from "../assets/iconHelpers"
import {type FolderTreeItem, type FolderTreeNode, buildFolderTree} from "../assets/utils"
import type {PromptsWorkflowRow} from "../store"
import type {PromptsTableRow} from "../types"

interface UsePromptsFolderTreeProps {
    /** Current view folders (scoped to current folder, or all when searching) */
    folders: Folder[]
    /** Current view workflows (scoped to current folder, or all when searching) */
    workflows: PromptsWorkflowRow[]
    /** All folders (for breadcrumbs, move modal, lookups) */
    allFolders: Folder[]
    isLoadingFolders: boolean
    isLoadingWorkflows: boolean
    searchTerm: string
}

export const usePromptsFolderTree = ({
    folders,
    workflows,
    allFolders,
    isLoadingFolders,
    isLoadingWorkflows,
    searchTerm,
}: UsePromptsFolderTreeProps) => {
    const isLoadingInitialData = useMemo(
        () => isLoadingFolders || isLoadingWorkflows,
        [isLoadingFolders, isLoadingWorkflows],
    )

    const isSearching = searchTerm.trim().length > 0

    // Build foldersById from ALL folders (needed for breadcrumbs, move modal, lookups)
    const foldersById = useMemo(() => {
        const map: Record<string, FolderTreeNode> = {}
        for (const folder of allFolders) {
            if (folder.id) {
                map[folder.id] = {...folder, type: "folder", children: []}
            }
        }
        return map
    }, [allFolders])

    // Tree data for the move modal (uses all folders)
    const treeData: DataNode[] = useMemo(() => {
        const {roots} = buildFolderTree(allFolders, [])

        const buildNodes = (nodes: FolderTreeItem[]): DataNode[] =>
            nodes.map((node) => {
                const isFolder = node.type === "folder"
                const childNodes = isFolder ? buildNodes(node.children ?? []) : undefined
                const hasChildren = (childNodes?.length ?? 0) > 0

                const icon = isFolder ? (
                    <FolderOpenOutlined style={{fontSize: 16, color: "#1C2C3D"}} />
                ) : (
                    getAppTypeIcon(node.appType)
                )

                return {
                    key: isFolder ? (node.id as string) : node.workflowId,
                    title: (
                        <div className="flex items-center gap-2 min-h-6 overflow-hidden">
                            <span className="flex items-center text-gray-400">{icon}</span>
                            <span className="truncate">{node.name}</span>
                        </div>
                    ),
                    children: hasChildren ? childNodes : undefined,
                    selectable: isFolder,
                    disableCheckbox: !isFolder,
                    disabled: !isFolder,
                }
            })

        return buildNodes(roots)
    }, [allFolders])

    const moveDestinationName = useCallback(
        (folderId: string | null) => (folderId ? (foldersById[folderId]?.name ?? folderId) : null),
        [foldersById],
    )

    const moveItemName = useCallback(
        (item: {name?: string | null} | null) => item?.name ?? null,
        [],
    )

    const deleteFolderName = useCallback(
        (folderId: string | null) => (folderId ? (foldersById[folderId]?.name ?? null) : null),
        [foldersById],
    )

    // Build display rows
    // Browse mode: flat list of folders + workflows (already server-filtered)
    // Search mode: build tree from all data, filter by search term
    const displayRows: FolderTreeItem[] = useMemo(() => {
        if (isSearching) {
            // Search: build full tree then filter
            const {roots} = buildFolderTree(folders, workflows)
            const normalizedSearch = searchTerm.trim().toLowerCase()

            const matchesSearch = (item: FolderTreeItem) =>
                (item.name ?? "").toLowerCase().includes(normalizedSearch)

            const filterNode = (item: FolderTreeItem): FolderTreeItem | null => {
                if (item.type === "folder") {
                    const filteredChildren = (item.children ?? [])
                        .map(filterNode)
                        .filter(Boolean) as FolderTreeItem[]

                    if (matchesSearch(item) || filteredChildren.length) {
                        return {...item, children: filteredChildren}
                    }
                    return null
                }
                return matchesSearch(item) ? item : null
            }

            return roots.map(filterNode).filter(Boolean) as FolderTreeItem[]
        }

        // Browse: flat list — folders first, then workflows
        const folderItems: FolderTreeItem[] = folders.map((f) => ({
            ...f,
            type: "folder" as const,
            children: [],
        }))
        const workflowItems: FolderTreeItem[] = workflows.map((w) => ({
            ...w,
            type: "app" as const,
        }))
        return [...folderItems, ...workflowItems]
    }, [folders, workflows, isSearching, searchTerm])

    const searchExpandedRowKeys = useMemo(() => {
        if (!isSearching) return []

        const expanded: string[] = []
        const collectFolderIds = (items: FolderTreeItem[]) => {
            items.forEach((item) => {
                if (item.type !== "folder") return
                if (item.children && item.children.length > 0) {
                    expanded.push(item.id as string)
                    collectFolderIds(item.children)
                }
            })
        }
        collectFolderIds(displayRows)
        return expanded
    }, [displayRows, isSearching])

    const getRowKey = useCallback(
        (item: FolderTreeItem) => (item.type === "folder" ? (item.id as string) : item.workflowId),
        [],
    )

    const tableRows: PromptsTableRow[] = useMemo(() => {
        if (isLoadingInitialData) return []

        const sanitizeNode = (item: FolderTreeItem): PromptsTableRow => {
            const baseNode = {
                ...item,
                key: getRowKey(item),
                __isSkeleton: false as const,
            } as PromptsTableRow

            if (item.type !== "folder") {
                return baseNode
            }

            const childItems = (item.children ?? []).map(sanitizeNode)

            if (childItems.length === 0) {
                const {children, ...rest} = baseNode
                return rest as PromptsTableRow
            }

            return {
                ...baseNode,
                children: childItems,
            }
        }

        return displayRows.map(sanitizeNode)
    }, [displayRows, getRowKey, isLoadingInitialData])

    const flattenedTableRows = useMemo(() => {
        const items: PromptsTableRow[] = []

        const traverse = (nodes: PromptsTableRow[]) => {
            nodes.forEach((node) => {
                items.push(node)
                if (node.children?.length) {
                    traverse(node.children)
                }
            })
        }

        traverse(tableRows)

        return items
    }, [tableRows])

    return {
        foldersById,
        treeData,
        moveDestinationName,
        moveItemName,
        deleteFolderName,
        isLoadingInitialData,
        searchExpandedRowKeys,
        tableRows,
        flattenedTableRows,
        getRowKey,
    }
}
