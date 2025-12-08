import {useMemo, useState} from "react"

import {Button, Dropdown, Input, Space, Table, Typography, message} from "antd"
import {ColumnsType} from "antd/es/table"
import dynamic from "next/dynamic"
import useSWR from "swr"
import {useAtomValue, useSetAtom} from "jotai"

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
import {buildFolderTree, FolderTreeNode, slugify} from "./assets/utils"
import {MoreOutlined} from "@ant-design/icons"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {DataNode} from "antd/es/tree"
import MoveFolderModal from "./modals/MoveFolderModal"
import DeleteFolderModal from "./modals/DeleteFolderModal"
import NewFolderModal, {FolderModalState} from "./modals/NewFolderModal"
import {Folder, FolderKind} from "@/oss/services/folders/types"
import SetupWorkflowIcon from "./components/SetupWorkflowIcon"
import {Template} from "@/oss/lib/Types"
import {ServiceType, createAndStartTemplate, deleteApp} from "@/oss/services/app-selector/api"
import {getTemplateKey, timeout} from "@/oss/components/pages/app-management/assets/helpers"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {isDemo} from "@/oss/lib/helpers/utils"
import {waitForAppToStart} from "@/oss/services/api"

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

const PromptsPage = () => {
    const {project, projectId} = useProjectData()
    const {secrets} = useVaultSecret()
    const posthog = usePostHogAg()
    const {user} = useProfileData()
    const {apps, mutate: mutateApps} = useAppsData()
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
    const [moveFolderId, setMoveFolderId] = useState<string | null>(null)
    const [templateKey, setTemplateKey] = useState<ServiceType | undefined>(undefined)
    const [newApp, setNewApp] = useState("")
    const [fetchingCustomWorkflow, setFetchingCustomWorkflow] = useState(false)
    const [newFolderState, setNewFolderState] = useState<FolderModalState>({
        ...INITIAL_FOLDER_MODAL_STATE,
    })
    const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
    const [isSavingFolder, setIsSavingFolder] = useState(false)
    const [isMovingFolder, setIsMovingFolder] = useState(false)
    const [isDeletingFolder, setIsDeletingFolder] = useState(false)

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

    const {roots, foldersById} = useMemo(() => {
        const folders = foldersData?.folders ?? []
        return buildFolderTree(folders)
    }, [foldersData])

    const appNameExist = useMemo(
        () => apps.some((app: any) => (app.app_name || "").toLowerCase() === newApp.toLowerCase()),
        [apps, newApp],
    )

    const treeData: DataNode[] = useMemo(() => {
        const buildNodes = (nodes: FolderTreeNode[]): DataNode[] =>
            nodes.map((node) => ({
                key: node.id!,
                title: node.name,
                children: buildNodes(node.children || []),
            }))

        return buildNodes(roots)
    }, [roots])

    const moveDestinationName = useMemo(() => {
        if (!moveSelection) return null
        return foldersById[moveSelection]?.name ?? moveSelection
    }, [moveSelection, foldersById])

    const moveFolderName = useMemo(() => {
        if (!moveFolderId) return null
        return foldersById[moveFolderId]?.name ?? moveFolderId
    }, [foldersById, moveFolderId])

    const deleteFolderName = useMemo(() => {
        if (!deleteFolderId) return null
        return foldersById[deleteFolderId]?.name ?? null
    }, [deleteFolderId, foldersById])

    // what we show in the table
    const visibleRows: FolderTreeNode[] = useMemo(() => {
        if (!currentFolderId) return roots
        const current = foldersById[currentFolderId]
        return current?.children ?? roots
    }, [currentFolderId, roots, foldersById])

    const handleRowClick = (record: FolderTreeNode) => {
        // only drill into folders; later you’ll have non-folder rows
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

    const handleOpenMoveModal = (folderId: string | null) => {
        if (!folderId) return

        setMoveFolderId(folderId)
        setMoveSelection(folderId)
        setMoveModalOpen(true)
    }

    const handleCloseMoveModal = () => {
        setMoveModalOpen(false)
        setMoveFolderId(null)
        setMoveSelection(null)
    }

    const moveFolder = async (
        folderId: string | null,
        destinationId: string | null,
        onSuccess?: () => void,
    ) => {
        if (!folderId || !destinationId) {
            message.warning("Select a destination folder")
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

        setIsMovingFolder(true)
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
            setIsMovingFolder(false)
        }
    }

    const handleMoveFolder = async () => {
        const moveSuccess = await moveFolder(moveFolderId, moveSelection, () => {
            setMoveModalOpen(false)
            setMoveFolderId(null)
            setMoveSelection(null)
        })

        if (!moveSuccess) return
    }

    const handleDropOnFolder = async (destinationId: string | null) => {
        if (!draggingFolderId) return

        await moveFolder(draggingFolderId, destinationId, () => {
            setMoveFolderId(null)
            setMoveSelection(null)
        })
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
            await mutate()

            if (currentFolderId === deleteFolderId) {
                setCurrentFolderId(parentId)
            }

            message.success("Folder deleted")
            handleCloseDeleteModal()
        } catch (error) {
            message.error("Failed to delete folder")
        } finally {
            setIsDeletingFolder(false)
        }
    }

    const columns: ColumnsType<FolderTreeNode> = [
        {
            title: "Name",
            dataIndex: "name",
            render: (name) => <span>{name}</span>,
        },
        {
            title: "Date modified",
            key: "dateModified",
            render: (_, record) => {
                return <div>{formatDay({date: record.updated_at})}</div>
            },
        },
        {
            title: "Type",
            key: "type",
        },
        {
            title: <GearSixIcon size={16} />,
            key: "actions",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "open_folder",
                                    label: "Open",
                                    icon: <NoteIcon size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
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
                                        handleOpenMoveModal(record.id as string)
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
                            ],
                        }}
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
    ]

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
                onMoveFolder={handleOpenMoveModal}
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
                </div>

                <Table<FolderTreeNode>
                    columns={columns}
                    dataSource={visibleRows}
                    loading={isLoading}
                    pagination={false}
                    bordered
                    rowKey="id"
                    onRow={(record) => ({
                        onClick: () => handleRowClick(record as any),
                        className: "cursor-pointer",
                        draggable: true,
                        onDragStart: (event) => {
                            event.stopPropagation()
                            setDraggingFolderId(record.id as string)
                        },
                        onDragEnd: () => setDraggingFolderId(null),
                        onDragOver: (event) => {
                            event.preventDefault()
                        },
                        onDrop: async (event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            await handleDropOnFolder(record.id as string)
                        },
                    })}
                />
            </div>

            <MoveFolderModal
                folderName={moveFolderName}
                moveDestinationName={moveDestinationName}
                open={moveModalOpen}
                onCancel={handleCloseMoveModal}
                onMove={handleMoveFolder}
                treeData={treeData}
                moveSelection={moveSelection}
                setMoveSelection={setMoveSelection}
                isMoving={isMovingFolder}
                disabledConfirm={!moveFolderId || !moveSelection || moveSelection === moveFolderId}
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
        </div>
    )
}

export default PromptsPage
