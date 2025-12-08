import {useMemo, useState} from "react"

import {Button, Dropdown, Input, Space, Table, Typography} from "antd"
import {ColumnsType} from "antd/es/table"
import useSWR from "swr"

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
import {useProjectData} from "@/oss/state/project"
import {queryFolders} from "@/oss/services/folders"
import PromptsBreadcrumb from "./components/PromptsBreadcrumb"
import {buildFolderTree, FolderTreeNode} from "./assets/utils"
import {MoreOutlined} from "@ant-design/icons"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {DataNode} from "antd/es/tree"
import MoveFolderModal from "./modals/MoveFolderModal"
import DeleteFolderModal from "./modals/DeleteFolderModal"

const {Title} = Typography

const PromptsPage = () => {
    const {project, projectId} = useProjectData()
    const [searchTerm, setSearchTerm] = useState("")
    const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
    const [renameModalOpen, setRenameModalOpen] = useState(false)
    const [moveModalOpen, setMoveModalOpen] = useState(false)
    const [newPromptModalOpen, setNewPromptModalOpen] = useState(false)
    const [newFolderModalOpen, setNewFolderModalOpen] = useState(false)
    const [setupWorkflowModalOpen, setSetupWorkflowModalOpen] = useState(false)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [renameValue, setRenameValue] = useState("")
    const [moveSelection, setMoveSelection] = useState<string | null>(null)
    const [newFolderName, setNewFolderName] = useState("")

    useBreadcrumbsEffect({breadcrumbs: {prompts: {label: "prompts"}}}, [])

    const {data: foldersData, isLoading} = useSWR(projectId ? ["folders", projectId] : null, () =>
        queryFolders({folder: {}}),
    )

    const {roots, foldersById} = useMemo(() => {
        const folders = foldersData?.folders ?? []
        return buildFolderTree(folders)
    }, [foldersData])

    const currentFolder = useMemo(
        () => (currentFolderId ? foldersById[currentFolderId] : null),
        [currentFolderId, foldersById],
    )

    const treeData: DataNode[] = useMemo(() => {
        const buildNodes = (nodes: FolderTreeNode[]): DataNode[] =>
            nodes.map((node) => ({
                key: node.id!,
                title: node.name,
                children: buildNodes(node.children || []),
                disableCheckbox: node.id === currentFolderId,
                selectable: node.id !== currentFolderId,
            }))

        return buildNodes(roots)
    }, [currentFolderId, roots])

    const moveDestinationName = useMemo(
        () => (moveSelection ? (foldersById[moveSelection]?.name ?? moveSelection) : null),
        [moveSelection, foldersById],
    )

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

    const columns: ColumnsType<FolderTreeNode> = [
        {
            title: "Name",
            dataIndex: "name",
            render: (name, record) => <span>{name}</span>,
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
                                    },
                                },
                                {
                                    key: "move_folder",
                                    label: "Move",
                                    icon: <FolderDashedIcon size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setMoveModalOpen(true)
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
                                        setDeleteModalOpen(true)
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
                        <Button icon={<TrashIcon />} danger>
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
                                            // onNewPrompt?.()
                                        },
                                    },
                                    {
                                        key: "new_folder",
                                        icon: <FolderIcon size={16} />,
                                        label: "New folder",
                                        onClick: (event) => {
                                            event.domEvent.stopPropagation()
                                            // onNewFolder?.()
                                        },
                                    },
                                    {
                                        type: "divider",
                                    },
                                    {
                                        key: "setup_workflow",
                                        icon: (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="16"
                                                height="16"
                                                viewBox="0 0 16 16"
                                                fill="none"
                                            >
                                                <path
                                                    d="M13.5 2.5H2.5C2.23478 2.5 1.98043 2.60536 1.79289 2.79289C1.60536 2.98043 1.5 3.23478 1.5 3.5V12.5C1.5 12.7652 1.60536 13.0196 1.79289 13.2071C1.98043 13.3946 2.23478 13.5 2.5 13.5H13.5C13.7652 13.5 14.0196 13.3946 14.2071 13.2071C14.3946 13.0196 14.5 12.7652 14.5 12.5V3.5C14.5 3.23478 14.3946 2.98043 14.2071 2.79289C14.0196 2.60536 13.7652 2.5 13.5 2.5ZM5.8 9.1C5.90609 9.17957 5.97622 9.29801 5.99497 9.42929C6.01373 9.56056 5.97957 9.69391 5.9 9.8C5.82044 9.90609 5.70199 9.97622 5.57071 9.99498C5.43944 10.0137 5.30609 9.97956 5.2 9.9L3.2 8.4C3.1379 8.35343 3.0875 8.29303 3.05279 8.22361C3.01807 8.15418 3 8.07762 3 8C3 7.92238 3.01807 7.84582 3.05279 7.77639C3.0875 7.70697 3.1379 7.64657 3.2 7.6L5.2 6.1C5.30609 6.02043 5.43944 5.98627 5.57071 6.00503C5.70199 6.02378 5.82044 6.09391 5.9 6.2C5.97957 6.30609 6.01373 6.43944 5.99497 6.57071C5.97622 6.70199 5.90609 6.82044 5.8 6.9L4.33313 8L5.8 9.1ZM9.48063 4.6375L7.48063 11.6375C7.46358 11.7018 7.43389 11.762 7.3933 11.8146C7.35271 11.8672 7.30203 11.9113 7.24423 11.9441C7.18642 11.9769 7.12265 11.9979 7.05665 12.0058C6.99064 12.0136 6.92373 12.0083 6.85982 11.99C6.79591 11.9717 6.73628 11.9409 6.68444 11.8993C6.63259 11.8577 6.58956 11.8062 6.55786 11.7477C6.52616 11.6893 6.50643 11.6251 6.49982 11.559C6.49321 11.4928 6.49986 11.426 6.51937 11.3625L8.51937 4.3625C8.55781 4.23733 8.64382 4.13224 8.75891 4.0698C8.87399 4.00736 9.00898 3.99256 9.13487 4.02857C9.26075 4.06459 9.36749 4.14855 9.43214 4.26241C9.49679 4.37627 9.5142 4.51094 9.48063 4.6375ZM12.8 8.4L10.8 9.9C10.6939 9.97956 10.5606 10.0137 10.4293 9.99498C10.298 9.97622 10.1796 9.90609 10.1 9.8C10.0204 9.69391 9.98627 9.56056 10.005 9.42929C10.0238 9.29801 10.0939 9.17957 10.2 9.1L11.6669 8L10.2 6.9C10.1475 6.8606 10.1032 6.81125 10.0698 6.75475C10.0363 6.69825 10.0143 6.63571 10.005 6.57071C9.99574 6.50571 9.99935 6.43952 10.0156 6.37591C10.0319 6.3123 10.0606 6.25253 10.1 6.2C10.1394 6.14747 10.1888 6.10322 10.2453 6.06976C10.3018 6.03631 10.3643 6.01431 10.4293 6.00503C10.4943 5.99574 10.5605 5.99935 10.6241 6.01564C10.6877 6.03194 10.7475 6.0606 10.8 6.1L12.8 7.6C12.8621 7.64657 12.9125 7.70697 12.9472 7.77639C12.9819 7.84582 13 7.92238 13 8C13 8.07762 12.9819 8.15418 12.9472 8.22361C12.9125 8.29303 12.8621 8.35343 12.8 8.4Z"
                                                    fill="#1C2C3D"
                                                />
                                            </svg>
                                        ),
                                        label: "Set up workflow",
                                        onClick: (event) => {
                                            event.domEvent.stopPropagation()
                                            // onSetupWorkflow?.()
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

                <Table<FolderTreeNode>
                    rowSelection={{type: "checkbox"}}
                    columns={columns}
                    dataSource={visibleRows}
                    loading={isLoading}
                    pagination={false}
                    bordered
                    rowKey="id"
                    onRow={(record) => ({
                        onClick: () => handleRowClick(record as any),
                        className: "cursor-pointer",
                    })}
                />
            </div>

            <MoveFolderModal
                foldername={currentFolder?.name}
                moveDestinationName={moveDestinationName}
                moveModalOpen={moveModalOpen}
                setMoveModalOpen={setMoveModalOpen}
                treeData={treeData}
                moveSelection={moveSelection}
                setMoveSelection={setMoveSelection}
            />

            <DeleteFolderModal
                deleteModalOpen={deleteModalOpen}
                setDeleteModalOpen={setDeleteModalOpen}
                folderName={currentFolder?.name}
            />
        </div>
    )
}

export default PromptsPage
