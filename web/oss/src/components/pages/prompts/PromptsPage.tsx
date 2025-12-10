import {Key, useCallback, useEffect, useMemo, useState} from "react"

import {atom} from "jotai"

import {Button, Dropdown, Input, Space, Spin, Typography, message} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"
import useSWR from "swr"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    FolderDashedIcon,
    FolderIcon,
    GearSixIcon,
    NoteIcon,
    PencilSimpleIcon,
    PlusIcon,
    SquaresFourIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {useProjectData} from "@/oss/state/project"
import {useTemplates, useAppsData} from "@/oss/state/app"
import {appCreationStatusAtom, resetAppCreationAtom} from "@/oss/state/appCreation/status"
import {useProfileData} from "@/oss/state/profile"
import {createFolder, deleteFolder, editFolder, queryFolders} from "@/oss/services/folders"
import PromptsBreadcrumb from "./components/PromptsBreadcrumb"
import {buildFolderTree, FolderTreeItem, FolderTreeNode, slugify} from "./assets/utils"
import {MoreOutlined} from "@ant-design/icons"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {DataNode} from "antd/es/tree"
import MoveFolderModal from "./modals/MoveFolderModal"
import DeleteFolderModal from "./modals/DeleteFolderModal"
import NewFolderModal, {FolderModalState} from "./modals/NewFolderModal"
import {Folder, FolderKind} from "@/oss/services/folders/types"
import SetupWorkflowIcon from "./components/SetupWorkflowIcon"
import {ListAppsItem, Template} from "@/oss/lib/Types"
import {
    ServiceType,
    createAndStartTemplate,
    deleteApp,
    updateAppFolder,
} from "@/oss/services/app-selector/api"
import {getTemplateKey, timeout} from "@/oss/components/pages/app-management/assets/helpers"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {isDemo} from "@/oss/lib/helpers/utils"
import {waitForAppToStart} from "@/oss/services/api"
import useURL from "@/oss/hooks/useURL"
import DeleteAppModal from "@/oss/components/pages/app-management/modals/DeleteAppModal"
import EditAppModal from "@/oss/components/pages/app-management/modals/EditAppModal"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import {InfiniteVirtualTableFeatureShell} from "@/oss/components/InfiniteVirtualTable"
import {createInfiniteDatasetStore} from "@/oss/components/InfiniteVirtualTable/createInfiniteDatasetStore"
import type {InfiniteTableRowBase} from "@/oss/components/InfiniteVirtualTable/types"
import type {
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable/features/InfiniteVirtualTableFeatureShell"

const CreateAppStatusModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/CreateAppStatusModal"),
)

const AddAppFromTemplatedModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/AddAppFromTemplateModal"),
)

const {Title} = Typography

const INITIAL_FOLDER_MODAL_STATE: FolderModalState = {
    name: "",
    description: "",
    modalOpen: false,
    mode: "create",
    folderId: null,
}

type PromptsTableRow = (FolderTreeItem & InfiniteTableRowBase) & {
    children?: PromptsTableRow[]
}

const promptsTableMetaAtom = atom({projectId: null as string | null})

const promptsDatasetStore = createInfiniteDatasetStore<
    PromptsTableRow,
    PromptsTableRow,
    {projectId: string | null}
>({
    key: "prompts-table",
    metaAtom: promptsTableMetaAtom,
    createSkeletonRow: ({rowKey}) => ({
        key: rowKey,
        __isSkeleton: true,
        type: "folder",
        id: rowKey,
        name: "",
        description: "",
        children: [],
    }),
    mergeRow: ({skeleton, apiRow}) => ({
        ...skeleton,
        ...(apiRow ?? {}),
        __isSkeleton: apiRow?.__isSkeleton ?? skeleton.__isSkeleton,
    }),
    isEnabled: () => false,
    fetchPage: async () => ({
        rows: [],
        totalCount: 0,
        hasMore: false,
        nextOffset: null,
        nextCursor: null,
        nextWindowing: null,
    }),
})

const PromptsPage = () => {
    const {project, projectId} = useProjectData()
    const {secrets} = useVaultSecret()
    const posthog = usePostHogAg()
    const router = useRouter()
    const {baseAppURL} = useURL()
    const {user} = useProfileData()
    const {apps, mutate: mutateApps, isLoading: isLoadingApps} = useAppsData()
    const [{data: templates = [], isLoading: fetchingTemplate}, noTemplateMessage] = useTemplates()
    const statusData = useAtomValue(appCreationStatusAtom)
    const setStatusData = useSetAtom(appCreationStatusAtom)
    const resetAppCreation = useSetAtom(resetAppCreationAtom)
    const [searchTerm, setSearchTerm] = useState("")
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
    const [moveModalOpen, setMoveModalOpen] = useState(false)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [isAddAppFromTemplatedModal, setIsAddAppFromTemplatedModal] = useState(false)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null)
    const [moveSelection, setMoveSelection] = useState<string | null>(null)
    const [templateKey, setTemplateKey] = useState<ServiceType | undefined>(undefined)
    const [newApp, setNewApp] = useState("")
    const [fetchingCustomWorkflow, setFetchingCustomWorkflow] = useState(false)
    const [moveEntity, setMoveEntity] = useState<{
        type: "folder" | "app"
        id: string
        name?: string | null
        currentParentId: string | null
    } | null>(null)
    const [newFolderState, setNewFolderState] = useState<FolderModalState>({
        ...INITIAL_FOLDER_MODAL_STATE,
    })
    const [draggingItem, setDraggingItem] = useState<{type: "folder" | "app"; id: string} | null>(
        null,
    )
    const [isSavingFolder, setIsSavingFolder] = useState(false)
    const [isMovingItem, setIsMovingItem] = useState(false)
    const [isDeletingFolder, setIsDeletingFolder] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
    const [selectedRow, setSelectedRow] = useState<FolderTreeItem | null>(null)
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)

    const {openModal: openCustomWorkflowModal} = useCustomWorkflowConfig({
        setStatusModalOpen,
        setFetchingTemplate: setFetchingCustomWorkflow,
        appId: "",
        folderId: currentFolderId,
        afterConfigSave: async () => mutateApps(),
    })

    useBreadcrumbsEffect({breadcrumbs: {prompts: {label: "prompts"}}}, [])

    const {
        data: foldersData,
        isLoading,
        mutate,
    } = useSWR(projectId ? ["folders", projectId] : null, () => queryFolders({folder: {}}))

    const isLoadingInitialData = useMemo(
        () => isLoading || isLoadingApps || !foldersData,
        [foldersData, isLoading, isLoadingApps],
    )

    const appNameExist = useMemo(
        () => apps.some((app: any) => (app.app_name || "").toLowerCase() === newApp.toLowerCase()),
        [apps, newApp],
    )

    const {roots, foldersById} = useMemo(() => {
        const folders = foldersData?.folders ?? []

        return buildFolderTree(folders, apps)
    }, [apps, foldersData])

    const getRowKey = useCallback(
        (item: FolderTreeItem) => (item.type === "folder" ? (item.id as string) : item.app_id),
        [],
    )

    const treeData: DataNode[] = useMemo(() => {
        const buildNodes = (nodes: FolderTreeItem[]): DataNode[] =>
            nodes.map((node) => {
                const isFolder = node.type === "folder"
                const childNodes = isFolder ? buildNodes(node.children ?? []) : undefined
                const hasChildren = (childNodes?.length ?? 0) > 0

                return {
                    key: isFolder ? (node.id as string) : node.app_id,
                    title: isFolder ? node.name : node.app_name,
                    children: hasChildren ? childNodes : undefined,
                    selectable: isFolder,
                    disableCheckbox: !isFolder,
                    disabled: !isFolder,
                    icon: isFolder ? <FolderIcon size={16} /> : <NoteIcon size={16} />,
                }
            })

        return buildNodes(roots)
    }, [roots])

    const moveDestinationName = useMemo(() => {
        if (!moveSelection) return null
        return foldersById[moveSelection]?.name ?? moveSelection
    }, [moveSelection, foldersById])

    const moveItemName = useMemo(() => moveEntity?.name ?? null, [moveEntity])

    const isMoveConfirmDisabled = useMemo(() => {
        if (!moveEntity) return true
        if (!moveSelection) return true

        const isSameFolder = moveEntity.type === "folder" && moveSelection === moveEntity.id
        const isSameDestination = moveSelection === moveEntity.currentParentId

        return isSameFolder || isSameDestination
    }, [moveEntity, moveSelection])

    const deleteFolderName = useMemo(() => {
        if (!deleteFolderId) return null
        return foldersById[deleteFolderId]?.name ?? null
    }, [deleteFolderId, foldersById])

    // keep your current visibleRows as-is (for navigation logic)
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
    }, [foldersById, roots, searchTerm, visibleRows])

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

    const rowKeyExtractor = useCallback((record: PromptsTableRow) => record.key, [])

    const handleRowClick = (record: FolderTreeItem) => {
        if (record.type !== "folder") return
        setCurrentFolderId(record.id as string | null)
    }

    const handleBreadcrumbFolderChange = (folderId: string | null) => {
        setCurrentFolderId(folderId)
    }

    const resetFolderModalState = () => {
        setNewFolderState({...INITIAL_FOLDER_MODAL_STATE})
    }

    const openNewFolderModal = () => {
        setNewFolderState({
            ...INITIAL_FOLDER_MODAL_STATE,
            modalOpen: true,
            mode: "create",
        })
    }

    const handleOpenRenameModal = (folderId: string | null) => {
        if (!folderId) return

        const folder = foldersById[folderId]
        if (!folder) return

        setNewFolderState({
            name: folder.name ?? "",
            description: folder.description ?? "",
            modalOpen: true,
            mode: "rename",
            folderId,
        })
    }

    const parentFolderIdForModal = useMemo(() => {
        if (newFolderState.mode === "rename" && newFolderState.folderId) {
            const folder = foldersById[newFolderState.folderId]
            if (folder) {
                return ((folder as any).parent_id as string | null) ?? null
            }
        }

        return currentFolderId
    }, [currentFolderId, foldersById, newFolderState.folderId, newFolderState.mode])

    const isRenameMode = newFolderState.mode === "rename"

    const newFolderSlug = useMemo(() => {
        const name = newFolderState.name.trim()
        return slugify(name)
    }, [newFolderState.name])

    const newFolderPath = useMemo(() => {
        const segments: string[] = []

        // build path from current folder upwards
        let currentId = parentFolderIdForModal
        while (currentId) {
            const folder = foldersById[currentId]
            if (!folder) break
            segments.push(slugify(folder.name || ""))
            // assume backend provides parent_id on the folder
            currentId = (folder as any).parent_id ?? null
        }

        segments.reverse()
        const leafName = newFolderState.name.trim()
        const leafSlug = slugify(leafName || "")
        if (leafSlug) {
            segments.push(leafSlug)
        }

        return `${segments.join("/")}`
    }, [foldersById, newFolderState.name, parentFolderIdForModal])

    const handleCreateFolder = async () => {
        const name = newFolderState.name.trim()
        if (!name) return

        const slug = slugify(name)
        const description = newFolderState.description.trim() || undefined

        if (isRenameMode && !newFolderState.folderId) {
            message.error("Select a folder to rename")
            return
        }

        setIsSavingFolder(true)
        try {
            if (isRenameMode && newFolderState.folderId) {
                await editFolder(newFolderState.folderId, {
                    folder: {
                        id: newFolderState.folderId,
                        name,
                        slug,
                        description,
                    },
                })
                message.success("Folder renamed")
            } else {
                await createFolder({
                    folder: {
                        name,
                        slug,
                        description,
                        kind: FolderKind.Applications,
                        parent_id: currentFolderId ?? null,
                    },
                })
                message.success("Folder created")
            }

            await mutate()
            resetFolderModalState()
        } catch (error) {
            message.error(isRenameMode ? "Failed to rename folder" : "Failed to create folder")
        } finally {
            setIsSavingFolder(false)
        }
    }

    const handleTemplateCardClick = async (template_id: string) => {
        setIsAddAppFromTemplatedModal(false)
        setStatusModalOpen(true)
        resetAppCreation()

        const apiKeys = secrets

        await createAndStartTemplate({
            appName: newApp,
            templateKey: template_id as ServiceType,
            folderId: currentFolderId ?? null,
            providerKey: isDemo() && apiKeys?.length === 0 ? [] : (apiKeys as LlmProvider[]),
            onStatusChange: async (status, details, appId) => {
                if (["error", "bad_request", "timeout", "success"].includes(status))
                    if (status === "success") {
                        await mutateApps()
                        posthog?.capture?.("app_deployment", {
                            properties: {
                                app_id: appId,
                                environment: "UI",
                                deployed_by: user?.id,
                            },
                        })
                    }

                setStatusData((prev) => ({...prev, status, details, appId: appId || prev.appId}))
            },
        })
    }

    const onErrorRetry = async () => {
        if (statusData.appId) {
            setStatusData((prev) => ({...prev, status: "cleanup", details: undefined}))
            await deleteApp(statusData.appId).catch(console.error)
            mutateApps()
        }
        if (templateKey) {
            await handleTemplateCardClick(templateKey as string)
        }
    }

    const onTimeoutRetry = async () => {
        if (!statusData.appId) return
        setStatusData((prev) => ({...prev, status: "starting_app", details: undefined}))
        try {
            await waitForAppToStart({appId: statusData.appId, timeout})
        } catch (error: any) {
            if (error.message === "timeout") {
                setStatusData((prev) => ({...prev, status: "timeout", details: undefined}))
            } else {
                setStatusData((prev) => ({...prev, status: "error", details: error}))
            }
        }
        setStatusData((prev) => ({...prev, status: "success", details: undefined}))
        mutateApps()
    }

    const handleOpenNewPromptModal = () => {
        setIsAddAppFromTemplatedModal(true)
    }

    const handleSetupWorkflow = () => {
        openCustomWorkflowModal()
    }

    const handleOpenAppOverview = (appId: string) => {
        router.push(`${baseAppURL}/${appId}/overview`)
    }

    const handleOpenMoveModal = (item: FolderTreeItem) => {
        if (!item) return

        const isFolder = item.type === "folder"
        const parentId = isFolder
            ? (((item as any).parent_id as string | null) ?? null)
            : (item.folder_id ?? null)

        setMoveEntity({
            type: item.type,
            id: isFolder ? (item.id as string) : item.app_id,
            name: isFolder ? item.name : item.app_name,
            currentParentId: parentId,
        })
        setMoveSelection(isFolder ? ((item.id as string) ?? null) : parentId)
        setMoveModalOpen(true)
    }

    const handleOpenFolderMoveModal = (folderId: string | null) => {
        if (!folderId) return
        const folder = foldersById[folderId]
        if (!folder) return
        handleOpenMoveModal(folder)
    }

    const handleCloseMoveModal = () => {
        setMoveModalOpen(false)
        setMoveEntity(null)
        setMoveSelection(null)
    }

    const moveFolder = async (
        folderId: string | null,
        destinationId: string | null,
        currentParentId: string | null,
        onSuccess?: () => void,
    ) => {
        if (!folderId || !destinationId) {
            message.warning("Select a destination folder")
            return false
        }

        if (destinationId === currentParentId) {
            message.info("Select a different folder to move to")
            return false
        }

        if (folderId === destinationId) {
            message.warning("Cannot move a folder into itself")
            return false
        }

        const folderToMove = foldersById[folderId]
        if (!folderToMove) {
            message.error("Folder not found")
            return false
        }

        // prevent moving folder into one of its own descendants
        let currentId: string | null = destinationId
        while (currentId) {
            if (currentId === folderId) {
                message.warning("Cannot move a folder into itself")
                return false
            }
            const currentFolder = foldersById[currentId] as Folder
            if (!currentFolder) break
            currentId = currentFolder.parent_id ?? null
        }

        const name = folderToMove.name ?? ""
        const slug = folderToMove.slug ?? slugify(name)
        const description = folderToMove.description
        const kind = (folderToMove as any).kind ?? FolderKind.Applications

        setIsMovingItem(true)
        try {
            await editFolder(folderId, {
                folder: {
                    id: folderId,
                    name,
                    slug,
                    description,
                    kind,
                    parent_id: destinationId, // new parent
                },
            })

            await mutate()
            onSuccess?.()
            message.success("Folder moved")
            return true
        } catch (error) {
            message.error("Failed to move folder")
            return false
        } finally {
            setIsMovingItem(false)
        }
    }

    const moveApp = async (
        appId: string | null,
        destinationId: string | null,
        currentFolderId: string | null,
        onSuccess?: () => void,
    ) => {
        if (!appId) return false
        if (!destinationId) {
            message.warning("Select a destination folder")
            return false
        }

        if (destinationId === currentFolderId) {
            message.info("Select a different folder to move to")
            return false
        }

        setIsMovingItem(true)
        try {
            await updateAppFolder(appId, destinationId)
            await mutateApps()
            onSuccess?.()
            message.success("App moved")
            return true
        } catch (error) {
            message.error("Failed to move app")
            return false
        } finally {
            setIsMovingItem(false)
        }
    }

    const handleMoveItem = async () => {
        if (!moveEntity) return

        const moveSuccess =
            moveEntity.type === "folder"
                ? await moveFolder(moveEntity.id, moveSelection, moveEntity.currentParentId, () => {
                      handleCloseMoveModal()
                  })
                : await moveApp(moveEntity.id, moveSelection, moveEntity.currentParentId, () => {
                      handleCloseMoveModal()
                  })

        if (!moveSuccess) return
    }

    const handleDropOnFolder = async (destinationId: string | null) => {
        if (!draggingItem) return

        const destinationFolder = destinationId ? foldersById[destinationId] : null
        if (destinationId && !destinationFolder) return

        if (draggingItem.type === "folder") {
            const folderToMove = foldersById[draggingItem.id]
            await moveFolder(
                draggingItem.id,
                destinationId,
                (folderToMove as any)?.parent_id ?? null,
            )
        } else {
            const appToMove = apps.find((app: ListAppsItem) => app.app_id === draggingItem.id) as
                | ListAppsItem
                | undefined

            if (!appToMove) return

            await moveApp(appToMove.app_id, destinationId, appToMove.folder_id ?? null)
        }

        setDraggingItem(null)
    }

    const folderHasApps = useCallback(
        (folderId: string | null) => {
            if (!folderId) return false

            const folder = foldersById[folderId]

            if (!folder) return false

            const stack = [...(folder.children ?? [])]

            while (stack.length) {
                const node = stack.pop()

                if (!node) continue

                if (node.type === "app") {
                    return true
                }

                if (node.type === "folder") {
                    stack.push(...(node.children ?? []))
                }
            }

            return false
        },
        [foldersById],
    )

    const handleOpenDeleteModal = (folderId: string | null) => {
        if (!folderId) return

        if (folderHasApps(folderId)) {
            message.warning(
                "Unable to delete folder. Please remove all prompts from this folder and subfolders",
            )
            return
        }

        setDeleteFolderId(folderId)
        setDeleteModalOpen(true)
    }

    const handleCloseDeleteModal = () => {
        setDeleteModalOpen(false)
        setDeleteFolderId(null)
    }

    const handleDeleteFolder = async () => {
        if (!deleteFolderId) return

        setIsDeletingFolder(true)
        try {
            const folder = foldersById[deleteFolderId] as Folder | undefined
            const parentId = folder?.parent_id ?? null

            await deleteFolder(deleteFolderId)
            await mutate()

            if (currentFolderId === deleteFolderId) {
                setCurrentFolderId(parentId)
            }

            message.success("Folder deleted")
            setSelectedRowKeys([])
            setSelectedRow(null)
            handleCloseDeleteModal()
        } catch (error) {
            message.error("Failed to delete folder")
        } finally {
            setIsDeletingFolder(false)
        }
    }

    const handleDeleteSelected = () => {
        if (!selectedRow) return

        if (selectedRow.type === "folder") {
            handleOpenDeleteModal(selectedRow.id as string)
            return
        }

        openDeleteAppModal(selectedRow as ListAppsItem)
    }

    const rowSelection = useMemo<InfiniteVirtualTableRowSelection<PromptsTableRow>>(
        () => ({
            type: "radio",
            columnWidth: 48,
            selectedRowKeys,
            onChange: (keys: Key[], selectedRows: PromptsTableRow[]) => {
                setSelectedRowKeys(keys as string[])
                setSelectedRow(selectedRows[0] ?? null)
            },
        }),
        [selectedRowKeys],
    )

    useEffect(() => {
        if (!selectedRowKeys.length) {
            setSelectedRow(null)
            return
        }

        const currentKey = selectedRowKeys[0]
        const currentRow = flattenedTableRows.find((item) => getRowKey(item) === currentKey) ?? null

        if (!currentRow) {
            setSelectedRowKeys([])
            setSelectedRow(null)
            return
        }

        setSelectedRow(currentRow)
    }, [flattenedTableRows, getRowKey, selectedRowKeys])

    const isLoadingTable = isLoadingInitialData

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: projectId ? `prompts-${projectId}` : "prompts",
            pageSize: Math.max(flattenedTableRows.length, 1),
            enableInfiniteScroll: false,
        }),
        [flattenedTableRows.length, projectId],
    )

    const tablePagination = useMemo<TableFeaturePagination<PromptsTableRow>>(
        () => ({
            rows: tableRows,
            loadNextPage: () => undefined,
            resetPages: () => undefined,
        }),
        [tableRows],
    )

    const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([])

    useEffect(() => {
        if (searchTerm) {
            setExpandedRowKeys(searchExpandedRowKeys)
            return
        }

        setExpandedRowKeys((previousKeys) => {
            if (previousKeys.length === 0) return previousKeys
            const validKeys = new Set(flattenedTableRows.map((row) => row.key))
            return previousKeys.filter((key) => validKeys.has(key))
        })
    }, [flattenedTableRows, searchExpandedRowKeys, searchTerm])

    const handleExpandedRowsChange = useCallback((keys: Key[]) => {
        setExpandedRowKeys(keys)
    }, [])

    const expandableConfig = useMemo(
        () => ({
            expandedRowKeys,
            onExpandedRowsChange: handleExpandedRowsChange,
            expandRowByClick: true,
            indentSize: 16,
            expandIconColumnWidth: 48,
        }),
        [expandedRowKeys, handleExpandedRowsChange],
    )

    const tableProps = useMemo(
        () => ({
            bordered: true,
            size: "small" as const,
            virtual: true,
            sticky: true,
            tableLayout: "fixed" as const,
            scroll: {x: "max-content" as const},
            onRow: (record: PromptsTableRow) => ({
                onClick:
                    record.type === "folder"
                        ? () => handleRowClick(record as FolderTreeNode)
                        : undefined,
                className: record.type === "folder" ? "cursor-pointer" : "",
                draggable: true,
                onDragStart: (event) => {
                    event.stopPropagation()
                    setDraggingItem({
                        type: record.type,
                        id: record.type === "folder" ? (record.id as string) : record.app_id,
                    })
                },
                onDragEnd: () => setDraggingItem(null),
                onDragOver:
                    record.type === "folder"
                        ? (event) => {
                              event.preventDefault()
                          }
                        : undefined,
                onDrop:
                    record.type === "folder"
                        ? async (event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              await handleDropOnFolder(record.id as string)
                          }
                        : undefined,
            }),
        }),
        [handleDropOnFolder, handleRowClick],
    )

    const columns: ColumnsType<PromptsTableRow> = useMemo(
        () => [
            {
                title: "Name",
                key: "name",
                width: 420,
                ellipsis: true,
                render: (_, record) => {
                    const isFolder = record.type === "folder"
                    const name = isFolder ? record.name : record.app_name

                    return (
                        <Space size={8} className="truncate">
                            {isFolder ? <FolderIcon size={16} /> : <NoteIcon size={16} />}
                            <span className="truncate">{name}</span>
                        </Space>
                    )
                },
            },
            {
                title: "Date modified",
                key: "dateModified",
                dataIndex: "updated_at",
                width: 200,
                render: (_, record) => {
                    return <div>{formatDay({date: record.updated_at})}</div>
                },
            },
            {
                title: "Type",
                key: "type",
                width: 160,
                render: (_, record) =>
                    record.type === "folder" ? "Folder" : record.app_type || "App",
            },
            {
                title: <GearSixIcon size={16} />,
                key: "actions",
                width: 72,
                fixed: "right",
                align: "center",
                render: (_, record) => {
                    const isFolder = record.type === "folder"

                    const folderActions = [
                        {
                            key: "open_folder",
                            label: "Open",
                            icon: <NoteIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleRowClick(record as FolderTreeNode)
                            },
                        },
                        {
                            key: "rename_folder",
                            label: "Rename",
                            icon: <PencilSimpleIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleOpenRenameModal(record.id as string)
                            },
                        },
                        {
                            key: "move_folder",
                            label: "Move",
                            icon: <FolderDashedIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleOpenMoveModal(record)
                            },
                        },
                        {
                            type: "divider",
                        },
                        {
                            key: "delete_folder",
                            label: "Delete",
                            icon: <TrashIcon size={16} />,
                            danger: true,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleOpenDeleteModal(record.id as string)
                            },
                        },
                    ]

                    const appActions = [
                        {
                            key: "open_app",
                            label: "Open",
                            icon: <NoteIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleOpenAppOverview(record.app_id)
                            },
                        },
                        {
                            key: "rename_app",
                            label: "Rename",
                            icon: <PencilSimpleIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                openEditAppModal(record as ListAppsItem)
                            },
                        },
                        {
                            key: "move_app",
                            label: "Move",
                            icon: <FolderDashedIcon size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                handleOpenMoveModal(record)
                            },
                        },
                        {
                            type: "divider",
                        },
                        {
                            key: "delete_app",
                            label: "Delete",
                            icon: <TrashIcon size={16} />,
                            danger: true,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                openDeleteAppModal(record as ListAppsItem)
                            },
                        },
                    ]

                    return (
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 180}}
                            menu={{items: isFolder ? folderActions : appActions}}
                        >
                            <Button
                                type="text"
                                onClick={(e) => e.stopPropagation()}
                                icon={<MoreOutlined />}
                                size="small"
                            />
                        </Dropdown>
                    )
                },
            },
        ],
        [
            handleOpenDeleteModal,
            handleOpenMoveModal,
            handleOpenRenameModal,
            handleOpenAppOverview,
            handleRowClick,
            openDeleteAppModal,
            openEditAppModal,
        ],
    )

    return (
        <div className="flex flex-col gap-4">
            <Title className="!m-0" level={2}>
                Prompts
            </Title>

            <PromptsBreadcrumb
                foldersById={foldersById}
                currentFolderId={currentFolderId}
                onFolderChange={handleBreadcrumbFolderChange}
                onNewPrompt={handleOpenNewPromptModal}
                onSetupWorkflow={handleSetupWorkflow}
                onNewFolder={openNewFolderModal}
                onMoveFolder={handleOpenFolderMoveModal}
                onRenameFolder={handleOpenRenameModal}
                onDeleteFolder={handleOpenDeleteModal}
            />

            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <Space>
                        <Input.Search
                            placeholder="Search"
                            allowClear
                            className="w-[400px]"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                        />
                    </Space>

                    <Space>
                        <Button
                            icon={<TrashIcon />}
                            danger
                            disabled={!selectedRow}
                            onClick={handleDeleteSelected}
                        >
                            Delete
                        </Button>

                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 200}}
                            placement="bottomLeft"
                            menu={{
                                items: [
                                    {
                                        key: "new_prompt",
                                        icon: <SquaresFourIcon size={16} />,
                                        label: "New prompt",
                                        onClick: (event) => {
                                            event.domEvent.stopPropagation()
                                            handleOpenNewPromptModal()
                                        },
                                    },
                                    {
                                        key: "new_folder",
                                        icon: <FolderIcon size={16} />,
                                        label: "New folder",
                                        onClick: (event) => {
                                            event.domEvent.stopPropagation()
                                            openNewFolderModal()
                                        },
                                    },
                                    {
                                        type: "divider",
                                    },
                                    {
                                        key: "setup_workflow",
                                        icon: <SetupWorkflowIcon />,
                                        label: "Set up workflow",
                                        onClick: (event) => {
                                            event.domEvent.stopPropagation()
                                            handleSetupWorkflow()
                                        },
                                    },
                                ],
                            }}
                        >
                            <Button icon={<PlusIcon />} type="primary">
                                Create new
                            </Button>
                        </Dropdown>
                    </Space>
                </div>

                <Spin spinning={isLoadingTable}>
                    <InfiniteVirtualTableFeatureShell<PromptsTableRow>
                        datasetStore={promptsDatasetStore}
                        tableScope={tableScope}
                        columns={columns}
                        rowKey={rowKeyExtractor}
                        dataSource={tableRows}
                        pagination={tablePagination}
                        rowSelection={rowSelection}
                        expandable={expandableConfig}
                        tableProps={tableProps}
                    />
                </Spin>
            </div>

            <MoveFolderModal
                itemName={moveItemName}
                moveDestinationName={moveDestinationName}
                open={moveModalOpen}
                onCancel={handleCloseMoveModal}
                onMove={handleMoveItem}
                treeData={treeData}
                moveSelection={moveSelection}
                setMoveSelection={setMoveSelection}
                isMoving={isMovingItem}
                disabledConfirm={isMoveConfirmDisabled}
            />

            <DeleteFolderModal
                open={deleteModalOpen}
                folderName={deleteFolderName ?? undefined}
                onCancel={handleCloseDeleteModal}
                onConfirm={handleDeleteFolder}
                confirmLoading={isDeletingFolder}
            />

            <NewFolderModal
                open={newFolderState.modalOpen}
                folderName={newFolderState.name}
                folderSlug={newFolderSlug}
                folderPath={newFolderPath}
                description={newFolderState.description}
                setNewFolderState={setNewFolderState}
                onCreate={handleCreateFolder}
                onCancel={resetFolderModalState}
                confirmLoading={isSavingFolder}
                title={isRenameMode ? "Rename folder" : "New folder"}
                okText={isRenameMode ? "Save" : "Create"}
            />

            <AddAppFromTemplatedModal
                open={isAddAppFromTemplatedModal}
                onCancel={() => setIsAddAppFromTemplatedModal(false)}
                newApp={newApp}
                templates={templates}
                noTemplateMessage={noTemplateMessage}
                templateKey={templateKey as ServiceType}
                appNameExist={appNameExist}
                setNewApp={setNewApp}
                onCardClick={(template: Template) => {
                    const selectedTemplateKey = getTemplateKey(template)

                    if (selectedTemplateKey) {
                        setTemplateKey(selectedTemplateKey)
                    }
                }}
                handleTemplateCardClick={handleTemplateCardClick}
                fetchingTemplate={!!fetchingTemplate}
                afterClose={() => {
                    setTemplateKey(undefined)
                    setNewApp("")
                }}
            />

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingTemplate || fetchingCustomWorkflow}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => {
                    setStatusModalOpen(false)
                    resetAppCreation()
                }}
                statusData={statusData}
                appName={newApp}
            />

            <DeleteAppModal />
            <EditAppModal />
        </div>
    )
}

export default PromptsPage
