import {useCallback, useMemo, useState} from "react"
import {DataNode} from "antd/es/tree"

import {ListAppsItem} from "@/oss/lib/Types"
import {Folder} from "@/oss/services/folders/types"

import {FolderTreeItem, buildFolderTree} from "../assets/utils"
import {PromptsTableRow} from "../types"
import {getAppTypeIcon} from "../assets/iconHelpers"
import {FolderFilled} from "@ant-design/icons"

interface UsePromptsFolderTreeProps {
    foldersData?: {folders?: Folder[]} | null
    apps: ListAppsItem[]
    isLoadingFolders: boolean
    isLoadingApps: boolean
}

export const usePromptsFolderTree = ({
    foldersData,
    apps,
    isLoadingFolders,
    isLoadingApps,
}: UsePromptsFolderTreeProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

    const isLoadingInitialData = useMemo(
        () => isLoadingFolders || isLoadingApps || !foldersData,
        [foldersData, isLoadingApps, isLoadingFolders],
    )

    const {roots, foldersById} = useMemo(() => {
        const folders = foldersData?.folders ?? []

        return buildFolderTree(folders, apps)
    }, [apps, foldersData])

    const treeData: DataNode[] = useMemo(() => {
        const buildNodes = (nodes: FolderTreeItem[]): DataNode[] =>
            nodes.map((node) => {
                const isFolder = node.type === "folder"
                const childNodes = isFolder ? buildNodes(node.children ?? []) : undefined
                const hasChildren = (childNodes?.length ?? 0) > 0

                const icon = isFolder ? (
                    <FolderFilled style={{fontSize: 16, color: "#BDC7D1"}} />
                ) : (
                    getAppTypeIcon(node.app_type)
                )

                return {
                    key: isFolder ? (node.id as string) : node.app_id,
                    title: (
                        <div className="flex items-center gap-2 min-h-6 overflow-hidden">
                            <span className="flex items-center text-gray-400">{icon}</span>
                            <span className="truncate">{isFolder ? node.name : node.app_name}</span>
                        </div>
                    ),
                    children: hasChildren ? childNodes : undefined,
                    selectable: isFolder,
                    disableCheckbox: !isFolder,
                    disabled: !isFolder,
                }
            })

        return buildNodes(roots)
    }, [roots])

    const moveDestinationName = useCallback(
        (folderId: string | null) => (folderId ? (foldersById[folderId]?.name ?? folderId) : null),
        [foldersById],
    )

    const moveItemName = useCallback(
        (item: FolderTreeItem | null) => item?.name ?? item?.app_name ?? null,
        [],
    )

    const deleteFolderName = useCallback(
        (folderId: string | null) => (folderId ? (foldersById[folderId]?.name ?? null) : null),
        [foldersById],
    )

    const visibleRows: FolderTreeItem[] = useMemo(() => {
        if (!currentFolderId) return roots
        const current = foldersById[currentFolderId]
        return current?.children ?? roots
    }, [currentFolderId, roots, foldersById])

    const filteredRows: FolderTreeItem[] = useMemo(() => {
        const normalizedSearchTerm = searchTerm.trim().toLowerCase()
        const rowsToFilter = normalizedSearchTerm ? roots : visibleRows

        if (!normalizedSearchTerm) return rowsToFilter

        const matchesSearch = (item: FolderTreeItem) => {
            const name = item.type === "folder" ? item.name : item.app_name
            return (name ?? "").toLowerCase().includes(normalizedSearchTerm)
        }

        const filterNode = (item: FolderTreeItem): FolderTreeItem | null => {
            if (item.type === "folder") {
                const filteredChildren = (item.children ?? [])
                    .map(filterNode)
                    .filter(Boolean) as FolderTreeItem[]

                if (matchesSearch(item) || filteredChildren.length) {
                    return {
                        ...item,
                        children: filteredChildren,
                    }
                }

                return null
            }

            return matchesSearch(item) ? item : null
        }

        return rowsToFilter.map(filterNode).filter(Boolean) as FolderTreeItem[]
    }, [roots, searchTerm, visibleRows])

    const searchExpandedRowKeys = useMemo(() => {
        if (!searchTerm.trim()) return []

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

        collectFolderIds(filteredRows)

        return expanded
    }, [filteredRows, searchTerm])

    const getRowKey = useCallback(
        (item: FolderTreeItem) => (item.type === "folder" ? (item.id as string) : item.app_id),
        [],
    )

    const tableRows: PromptsTableRow[] = useMemo(() => {
        if (isLoadingInitialData) return []

        const sanitizeNode = (item: FolderTreeItem): PromptsTableRow => {
            const baseNode: PromptsTableRow = {
                ...item,
                key: getRowKey(item),
                __isSkeleton: false,
            }

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

        return filteredRows.map(sanitizeNode)
    }, [filteredRows, getRowKey, isLoadingInitialData])

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
        currentFolderId,
        setCurrentFolderId,
        searchTerm,
        setSearchTerm,
        foldersById,
        roots,
        treeData,
        moveDestinationName,
        moveItemName,
        deleteFolderName,
        isLoadingInitialData,
        visibleRows,
        filteredRows,
        searchExpandedRowKeys,
        tableRows,
        flattenedTableRows,
        getRowKey,
    }
}
