import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import useSWR from "swr"

import {TableFeaturePagination, TableScopeConfig} from "@/oss/components/InfiniteVirtualTable"
import {getTemplateKey, timeout} from "@/oss/components/pages/app-management/assets/helpers"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import DeleteAppModal from "@/oss/components/pages/app-management/modals/DeleteAppModal"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
// TEMPORARY: Disabling name editing
// import EditAppModal from "@/oss/components/pages/app-management/modals/EditAppModal"
// TEMPORARY: Disabling name editing
// import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import useURL from "@/oss/hooks/useURL"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {isDemo} from "@/oss/lib/helpers/utils"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {ListAppsItem, Template} from "@/oss/lib/Types"
import {waitForAppToStart} from "@/oss/services/api"
import {
    ServiceType,
    createAndStartTemplate,
    deleteApp,
    updateAppFolder,
} from "@/oss/services/app-selector/api"
import {createFolder, deleteFolder, editFolder, queryFolders} from "@/oss/services/folders"
import {Folder, FolderKind} from "@/oss/services/folders/types"
import {useTemplates, useAppsData} from "@/oss/state/app"
import {appCreationStatusAtom, resetAppCreationAtom} from "@/oss/state/appCreation/status"
import {useProfileData} from "@/oss/state/profile"
import {useProjectData} from "@/oss/state/project"

import PageLayout from "../../PageLayout/PageLayout"

import {getAppTypeIcon} from "./assets/iconHelpers"
import {FolderTreeItem, slugify} from "./assets/utils"
import PromptsBreadcrumb from "./components/PromptsBreadcrumb"
import {PromptsTableSection} from "./components/PromptsTableSection"
import {usePromptsColumns} from "./hooks/usePromptsColumns"
import {usePromptsFolderTree} from "./hooks/usePromptsFolderTree"
import {usePromptsSelection} from "./hooks/usePromptsSelection"
import DeleteFolderModal from "./modals/DeleteFolderModal"
import MoveFolderModal from "./modals/MoveFolderModal"
import NewFolderModal, {FolderModalState} from "./modals/NewFolderModal"
import {promptsDatasetStore, promptsTableMetaAtom} from "./store"
import {PromptsTableRow} from "./types"

const CreateAppStatusModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/CreateAppStatusModal"),
)

const AddAppFromTemplatedModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/AddAppFromTemplateModal"),
)

const INITIAL_FOLDER_MODAL_STATE: FolderModalState = {
    name: "",
    modalOpen: false,
    mode: "create",
    folderId: null,
}

const PromptsPage = () => {
    const {projectId} = useProjectData()
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
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    // TEMPORARY: Disabling name editing
    // const openEditAppModal = useSetAtom(openEditAppModalAtom)
    const setPromptsTableMeta = useSetAtom(promptsTableMetaAtom)

    useBreadcrumbsEffect({breadcrumbs: {prompts: {label: "prompts"}}}, [])

    const {
        data: foldersData,
        isLoading: isLoadingFolders,
        mutate,
    } = useSWR(projectId ? ["folders", projectId] : null, () =>
        queryFolders({folder: {}}, projectId),
    )

    const {
        currentFolderId,
        setCurrentFolderId: setCurrentFolderIdState,
        searchTerm,
        setSearchTerm,
        foldersById,
        treeData,
        moveDestinationName: getMoveDestinationName,
        moveItemName: getMoveItemName,
        deleteFolderName: getDeleteFolderName,
        searchExpandedRowKeys,
        tableRows,
        flattenedTableRows,
        getRowKey,
    } = usePromptsFolderTree({
        foldersData,
        apps,
        isLoadingFolders,
        isLoadingApps,
    })

    const updateFolderInUrl = useCallback(
        (folderId: string | null) => {
            const {folderId: _, ...restQuery} = router.query
            const nextQuery = {...restQuery}

            if (folderId) {
                nextQuery.folderId = folderId
            }

            router.replace(
                {
                    pathname: router.pathname,
                    query: nextQuery,
                },
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    const setCurrentFolder = useCallback(
        (folderId: string | null) => {
            setCurrentFolderIdState(folderId)
            updateFolderInUrl(folderId)
        },
        [setCurrentFolderIdState, updateFolderInUrl],
    )

    useEffect(() => {
        if (!router.isReady) return

        const folderIdParam = router.query.folderId
        const folderId = (Array.isArray(folderIdParam) ? folderIdParam[0] : folderIdParam) ?? null

        if (!folderId) {
            setCurrentFolderIdState((prev) => (prev !== null ? null : prev))
            return
        }

        if (!foldersById[folderId]) return

        setCurrentFolderIdState((prev) => (prev === folderId ? prev : folderId))
    }, [foldersById, router.isReady, router.query.folderId, setCurrentFolderIdState])

    useEffect(() => {
        if (!router.isReady || isLoadingFolders) return

        const folderIdParam = router.query.folderId
        const folderId = (Array.isArray(folderIdParam) ? folderIdParam[0] : folderIdParam) ?? null

        if (folderId && !foldersById[folderId]) {
            setCurrentFolder(null)
        }
    }, [foldersById, isLoadingFolders, router.isReady, router.query.folderId, setCurrentFolder])

    const {openModal: openCustomWorkflowModal} = useCustomWorkflowConfig({
        setStatusModalOpen,
        setFetchingTemplate: setFetchingCustomWorkflow,
        appId: "",
        folderId: currentFolderId,
        afterConfigSave: async () => mutateApps(),
    })

    const {setSelectedRowKeys, selectedRow, setSelectedRow, rowSelection} = usePromptsSelection({
        flattenedTableRows,
        getRowKey,
    })

    const appNameExist = useMemo(
        () => apps.some((app: any) => (app.app_name || "").toLowerCase() === newApp.toLowerCase()),
        [apps, newApp],
    )

    useEffect(() => {
        setPromptsTableMeta({projectId})
    }, [projectId, setPromptsTableMeta])

    const moveDestinationName = useMemo(
        () => getMoveDestinationName(moveSelection),
        [getMoveDestinationName, moveSelection],
    )

    const moveItemName = useMemo(() => getMoveItemName(moveEntity), [getMoveItemName, moveEntity])

    const deleteFolderName = useMemo(
        () => getDeleteFolderName(deleteFolderId),
        [deleteFolderId, getDeleteFolderName],
    )

    const isMoveConfirmDisabled = useMemo(() => {
        if (!moveEntity) return true
        if (!moveSelection) return true

        const isSameFolder = moveEntity.type === "folder" && moveSelection === moveEntity.id
        const isSameDestination = moveSelection === moveEntity.currentParentId

        return isSameFolder || isSameDestination
    }, [moveEntity, moveSelection])

    const rowKeyExtractor = useCallback((record: PromptsTableRow) => record.key, [])

    const handleRowClick = (record: FolderTreeItem) => {
        if (record.type === "folder") {
            setCurrentFolder(record.id as string | null)
            return
        }

        handleOpenAppOverview(record.app_id)
    }

    const handleBreadcrumbFolderChange = (folderId: string | null) => {
        setCurrentFolder(folderId)
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
                    },
                })
                message.success("Folder renamed")
            } else {
                await createFolder({
                    folder: {
                        name,
                        slug,
                        kind: FolderKind.Applications,
                        parent_id: currentFolderId ?? null,
                    },
                })
                message.success("Folder created")
            }

            await mutate()
            resetFolderModalState()
        } catch (error) {
            const apiMessage = (error as any)?.response?.data?.detail
            message.error(apiMessage)
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
        const kind = (folderToMove as any).kind ?? FolderKind.Applications

        setIsMovingItem(true)
        try {
            await editFolder(folderId, {
                folder: {
                    id: folderId,
                    name,
                    slug,
                    kind,
                    parent_id: destinationId, // new parent
                },
            })

            await mutate()
            onSuccess?.()
            message.success("Folder moved")
            return true
        } catch (error) {
            const apiMessage = (error as any)?.response?.data?.detail
            message.error(apiMessage)
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
            const apiMessage = (error as any)?.response?.data?.detail
            message.error(apiMessage)
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
                setCurrentFolder(parentId)
            }

            message.success("Folder deleted")
            setSelectedRowKeys([])
            setSelectedRow(null)
            handleCloseDeleteModal()
        } catch (error) {
            const apiMessage = (error as any)?.response?.data?.detail
            message.error(apiMessage)
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

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: projectId ? `prompts-${projectId}` : "prompts",
            pageSize: Math.max(tableRows.length, 1),
            enableInfiniteScroll: false,
        }),
        [projectId, tableRows.length],
    )

    const tablePagination = useMemo<TableFeaturePagination<PromptsTableRow>>(
        () => ({
            rows: tableRows,
            loadNextPage: () => undefined,
            resetPages: () => undefined,
        }),
        [tableRows],
    )

    const tableExpandableConfig = useMemo(
        () => ({
            defaultExpandAllRows: Boolean(searchTerm),
            defaultExpandedRowKeys: searchTerm ? searchExpandedRowKeys : undefined,
            rowExpandable: (record: PromptsTableRow) => Boolean(record.children?.length),
        }),
        [searchExpandedRowKeys, searchTerm],
    )

    const tableInstanceKey = useMemo(
        () => (searchTerm ? `search-${searchTerm}` : `folder-${currentFolderId ?? "root"}`),
        [currentFolderId, searchTerm],
    )

    const tableProps = useMemo(
        () => ({
            key: tableInstanceKey,
            bordered: true,
            size: "small" as const,
            virtual: true,
            sticky: true,
            tableLayout: "fixed" as const,
            scroll: {x: "max-content" as const},
            expandable: tableExpandableConfig,
            onRow: (record: PromptsTableRow) => ({
                onClick: () => handleRowClick(record),
                className: "cursor-pointer",
                draggable: true,
                onDragStart: (event: any) => {
                    event.stopPropagation()
                    setDraggingItem({
                        type: record.type,
                        id: record.type === "folder" ? (record.id as string) : record.app_id,
                    })
                },
                onDragEnd: () => setDraggingItem(null),
                onDragOver:
                    record.type === "folder"
                        ? (event: any) => {
                              event.preventDefault()
                          }
                        : undefined,
                onDrop:
                    record.type === "folder"
                        ? async (event: any) => {
                              event.preventDefault()
                              event.stopPropagation()
                              await handleDropOnFolder(record.id as string)
                          }
                        : undefined,
            }),
        }),
        [handleDropOnFolder, handleRowClick, tableExpandableConfig, tableInstanceKey],
    )

    const renderAppTypeIcon = useCallback((appType?: string) => getAppTypeIcon(appType), [])

    const columns = usePromptsColumns({
        onFolderClick: handleRowClick,
        onRenameFolder: handleOpenRenameModal,
        onDeleteFolder: handleOpenDeleteModal,
        onMoveItem: handleOpenMoveModal,
        onOpenAppOverview: handleOpenAppOverview,
        // TEMPORARY: Disabling name editing
        // onOpenEditAppModal: openEditAppModal,
        onOpenDeleteAppModal: openDeleteAppModal,
        getAppTypeIcon: renderAppTypeIcon,
    })

    return (
        <PageLayout className="grow min-h-0" title="Prompts">
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

            <PromptsTableSection
                columns={columns}
                datasetStore={promptsDatasetStore}
                tableRows={tableRows}
                rowKeyExtractor={rowKeyExtractor}
                tableScope={tableScope}
                tablePagination={tablePagination}
                rowSelection={rowSelection}
                tableProps={tableProps}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                selectedRow={selectedRow}
                onDeleteSelected={handleDeleteSelected}
                onOpenNewPrompt={handleOpenNewPromptModal}
                onOpenNewFolder={openNewFolderModal}
                onSetupWorkflow={handleSetupWorkflow}
            />

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
            {/* TEMPORARY: Disabling name editing */}
            {/* <EditAppModal /> */}
        </PageLayout>
    )
}

export default PromptsPage
