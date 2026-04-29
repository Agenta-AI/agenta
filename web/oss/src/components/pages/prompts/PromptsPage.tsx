import {useCallback, useEffect, useMemo, useState} from "react"

import {
    appTemplatesQueryAtom,
    createEphemeralAppFromTemplate,
    type AppType,
} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {PageLayout} from "@agenta/ui"
import type {
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@agenta/ui/table"
import {message} from "antd"
import type {TableProps} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {timeout} from "@/oss/components/pages/app-management/assets/helpers"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import DeleteAppModal from "@/oss/components/pages/app-management/modals/DeleteAppModal"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {waitForAppToStart} from "@/oss/services/api"
import {updateAppFolder} from "@/oss/services/app-selector/api"
import {createFolder, deleteFolder, editFolder} from "@/oss/services/folders"
import {Folder, FolderKind} from "@/oss/services/folders/types"
import {appCreationStatusAtom, resetAppCreationAtom} from "@/oss/state/appCreation/status"
import {useProjectData} from "@/oss/state/project"

import {type FolderTreeItem, slugify} from "./assets/utils"
import PromptsBreadcrumb from "./components/PromptsBreadcrumb"
import {PromptsTableSection} from "./components/PromptsTableSection"
import {createPromptsColumns, type PromptsColumnActions} from "./hooks/usePromptsColumns"
import {usePromptsFolderTree} from "./hooks/usePromptsFolderTree"
import {usePromptsSelection} from "./hooks/usePromptsSelection"
import DeleteFolderModal from "./modals/DeleteFolderModal"
import MoveFolderModal from "./modals/MoveFolderModal"
import NewFolderModal, {FolderModalState} from "./modals/NewFolderModal"
import {
    foldersAtom,
    foldersLoadingAtom,
    refetchFoldersAtom,
    allFoldersAtom,
    refetchAllFoldersAtom,
    workflowsAtom,
    workflowsLoadingAtom,
    refetchWorkflowsAtom,
    promptsSearchTermAtom,
    currentFolderIdAtom,
} from "./store"
import type {PromptsTableRow} from "./types"

const CreateAppStatusModal: any = dynamic(
    () => import("@/oss/components/pages/app-management/modals/CreateAppStatusModal"),
)

const INITIAL_FOLDER_MODAL_STATE: FolderModalState = {
    name: "",
    modalOpen: false,
    mode: "create",
    folderId: null,
}

const PromptsPage = () => {
    const {projectId} = useProjectData()
    const router = useRouter()
    const {baseAppURL} = useURL()
    const statusData = useAtomValue(appCreationStatusAtom)
    const setStatusData = useSetAtom(appCreationStatusAtom)
    const resetAppCreation = useSetAtom(resetAppCreationAtom)
    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)

    // Pre-fetch the catalog templates on page mount so the breadcrumb
    // "+ New prompt" shortcut has data ready. Same rationale as on /apps.
    useAtomValue(appTemplatesQueryAtom)

    // Entity-based data (scoped to current folder, or all when searching)
    const folders = useAtomValue(foldersAtom)
    const isLoadingFolders = useAtomValue(foldersLoadingAtom)
    const refetchFolders = useSetAtom(refetchFoldersAtom)
    const allFolders = useAtomValue(allFoldersAtom)
    const refetchAllFolders = useSetAtom(refetchAllFoldersAtom)
    const workflows = useAtomValue(workflowsAtom)
    const isLoadingWorkflows = useAtomValue(workflowsLoadingAtom)
    const refetchWorkflows = useSetAtom(refetchWorkflowsAtom)
    const searchTerm = useAtomValue(promptsSearchTermAtom)
    const setSearchTerm = useSetAtom(promptsSearchTermAtom)
    const currentFolderId = useAtomValue(currentFolderIdAtom)
    const setCurrentFolderIdState = useSetAtom(currentFolderIdAtom)

    const [moveModalOpen, setMoveModalOpen] = useState(false)
    const [statusModalOpen, setStatusModalOpen] = useState(false)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null)
    const [moveSelection, setMoveSelection] = useState<string | null>(null)
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

    // Refetch both scoped folders and all folders together
    const refetchAllFolderData = useCallback(() => {
        refetchFolders()
        refetchAllFolders()
    }, [refetchFolders, refetchAllFolders])

    useBreadcrumbsEffect({breadcrumbs: {prompts: {label: "prompts"}}}, [])

    const {
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
        folders,
        workflows,
        allFolders,
        isLoadingFolders,
        isLoadingWorkflows,
        searchTerm,
    })

    const handleSearchChange = useCallback(
        (value: string) => {
            setSearchTerm(value)
        },
        [setSearchTerm],
    )

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
            if (currentFolderId !== null) setCurrentFolderIdState(null)
            return
        }

        if (!foldersById[folderId]) return

        if (currentFolderId !== folderId) setCurrentFolderIdState(folderId)
    }, [
        currentFolderId,
        foldersById,
        router.isReady,
        router.query.folderId,
        setCurrentFolderIdState,
    ])

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
        afterConfigSave: async () => refetchWorkflows(),
    })

    const {setSelectedRowKeys, selectedRow, setSelectedRow, rowSelection} = usePromptsSelection({
        flattenedTableRows,
        getRowKey,
    })

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

    const handleRowClick = (record: FolderTreeItem) => {
        if (record.type === "folder") {
            setCurrentFolder(record.id as string | null)
            return
        }

        handleOpenAppOverview(record.workflowId)
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
                return folder.parent_id ?? null
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

        let currentId = parentFolderIdForModal
        while (currentId) {
            const folder = foldersById[currentId]
            if (!folder) break
            segments.push(slugify(folder.name || ""))
            currentId = folder.parent_id ?? null
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

            refetchAllFolderData()
            resetFolderModalState()
        } catch (error) {
            const apiMessage = (error as any)?.response?.data?.detail
            message.error(apiMessage)
        } finally {
            setIsSavingFolder(false)
        }
    }

    /**
     * "+ New prompt" entry in the breadcrumb / table-section menus. The menu
     * surfaces a Chat / Completion submenu so the type is chosen explicitly
     * before we mint the ephemeral app. Custom workflow has its own entry
     * (`handleSetupWorkflow`).
     */
    const handleOpenNewPromptModal = useCallback(
        async (type: AppType) => {
            const entityId = await createEphemeralAppFromTemplate({type})
            if (!entityId) {
                message.error("Couldn't start prompt creation — please retry")
                return
            }
            setOpenDrawer({
                entityId,
                context: "app-create",
                onWorkflowCreated: ({newAppId, newRevisionId} = {}) => {
                    if (!newAppId || !newRevisionId) return
                    router.push(`${baseAppURL}/${newAppId}/playground?revisions=${newRevisionId}`)
                },
            })
        },
        [baseAppURL, router, setOpenDrawer],
    )

    const handleSetupWorkflow = () => {
        openCustomWorkflowModal()
    }

    /**
     * Status modal is mounted for the Custom workflow path — Custom is still
     * eager-create with progress states. Retry handlers are no-ops here:
     * Custom errors require the user to fix the form and resubmit, not a
     * blind retry of the same payload.
     */
    const onErrorRetry = useCallback(() => {
        setStatusModalOpen(false)
        resetAppCreation()
    }, [resetAppCreation])

    const onTimeoutRetry = useCallback(async () => {
        if (!statusData.appId) return
        setStatusData((prev) => ({...prev, status: "configuring_app", details: undefined}))
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
        refetchWorkflows()
    }, [refetchWorkflows, setStatusData, statusData.appId])

    const handleOpenAppOverview = (workflowId: string) => {
        router.push(`${baseAppURL}/${workflowId}/overview`)
    }

    const handleOpenMoveModal = (item: FolderTreeItem) => {
        if (!item) return

        const isFolder = item.type === "folder"
        const parentId = isFolder ? (item.parent_id ?? null) : (item.folderId ?? null)

        setMoveEntity({
            type: item.type,
            id: isFolder ? (item.id as string) : item.workflowId,
            name: item.name,
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
                    parent_id: destinationId,
                },
            })

            refetchAllFolderData()
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
        workflowId: string | null,
        destinationId: string | null,
        currentFolderId: string | null,
        onSuccess?: () => void,
    ) => {
        if (!workflowId) return false
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
            await updateAppFolder(workflowId, destinationId)
            refetchWorkflows()
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
            await moveFolder(draggingItem.id, destinationId, folderToMove?.parent_id ?? null)
        } else {
            const workflow = workflows.find((w) => w.workflowId === draggingItem.id)
            if (!workflow) return
            await moveApp(workflow.workflowId, destinationId, workflow.folderId ?? null)
        }

        setDraggingItem(null)
    }

    const handleOpenDeleteModal = (folderId: string | null) => {
        if (!folderId) return
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
            refetchAllFolderData()

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

        openDeleteAppModal({
            id: selectedRow.workflowId,
            name: selectedRow.name,
        })
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

    const tableProps = useMemo<TableProps<PromptsTableRow>>(
        () => ({
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
                        id: record.type === "folder" ? (record.id as string) : record.workflowId,
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
        [handleDropOnFolder, handleRowClick, tableExpandableConfig],
    )

    const columnActions = useMemo<PromptsColumnActions>(
        () => ({
            onFolderClick: handleRowClick,
            onRenameFolder: handleOpenRenameModal,
            onDeleteFolder: handleOpenDeleteModal,
            onMoveItem: handleOpenMoveModal,
            onOpenAppOverview: handleOpenAppOverview,
            onDeleteApp: (record) => {
                openDeleteAppModal({
                    id: record.workflowId,
                    name: record.name,
                })
            },
        }),
        [
            handleRowClick,
            handleOpenRenameModal,
            handleOpenDeleteModal,
            handleOpenMoveModal,
            handleOpenAppOverview,
            openDeleteAppModal,
        ],
    )

    const columns = useMemo(() => createPromptsColumns(columnActions), [columnActions])

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
                tableRows={tableRows}
                tableScope={tableScope}
                tablePagination={tablePagination}
                rowSelection={rowSelection as InfiniteVirtualTableRowSelection<PromptsTableRow>}
                tableProps={tableProps}
                searchTerm={searchTerm}
                onSearchChange={handleSearchChange}
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

            <CreateAppStatusModal
                open={statusModalOpen}
                loading={fetchingCustomWorkflow}
                onErrorRetry={onErrorRetry}
                onTimeoutRetry={onTimeoutRetry}
                onCancel={() => {
                    setStatusModalOpen(false)
                    resetAppCreation()
                }}
                statusData={statusData}
                appName=""
            />

            <DeleteAppModal />
        </PageLayout>
    )
}

export default PromptsPage
