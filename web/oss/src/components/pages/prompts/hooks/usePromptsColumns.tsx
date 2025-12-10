import {useMemo} from "react"

import {Dropdown, Button, Space, MenuProps} from "antd"
import {ColumnsType} from "antd/es/table"
import {MoreOutlined} from "@ant-design/icons"

import {
    FolderDashedIcon,
    FolderIcon,
    GearSixIcon,
    NoteIcon,
    PencilSimpleIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import {ListAppsItem} from "@/oss/lib/Types"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"

import {FolderTreeNode} from "../assets/utils"
import {PromptsTableRow} from "../types"

interface UsePromptsColumnsProps {
    onFolderClick: (folder: FolderTreeNode) => void
    onRenameFolder: (folderId: string) => void
    onDeleteFolder: (folderId: string) => void
    onMoveItem: (item: PromptsTableRow) => void
    onOpenAppOverview: (appId: string) => void
    onOpenEditAppModal: (app: ListAppsItem) => void
    onOpenDeleteAppModal: (app: ListAppsItem) => void
}

export const usePromptsColumns = ({
    onFolderClick,
    onRenameFolder,
    onDeleteFolder,
    onMoveItem,
    onOpenAppOverview,
    onOpenEditAppModal,
    onOpenDeleteAppModal,
}: UsePromptsColumnsProps) =>
    useMemo<ColumnsType<PromptsTableRow>>(
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
                render: (_, record) => <div>{formatDay({date: record.updated_at})}</div>,
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
                width: 56,
                fixed: "right",
                align: "center",
                render: (_, record) => {
                    const isFolder = record.type === "folder"

                    const folderActions: MenuProps["items"] = [
                        {
                            key: "open_folder",
                            label: "Open",
                            icon: <NoteIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onFolderClick(record as FolderTreeNode)
                            },
                        },
                        {
                            key: "rename_folder",
                            label: "Rename",
                            icon: <PencilSimpleIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onRenameFolder(record.id as string)
                            },
                        },
                        {
                            key: "move_folder",
                            label: "Move",
                            icon: <FolderDashedIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onMoveItem(record)
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
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onDeleteFolder(record.id as string)
                            },
                        },
                    ]

                    const appActions: MenuProps["items"] = [
                        {
                            key: "open_app",
                            label: "Open",
                            icon: <NoteIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onOpenAppOverview(record.app_id)
                            },
                        },
                        {
                            key: "rename_app",
                            label: "Rename",
                            icon: <PencilSimpleIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onOpenEditAppModal(record as ListAppsItem)
                            },
                        },
                        {
                            key: "move_app",
                            label: "Move",
                            icon: <FolderDashedIcon size={16} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onMoveItem(record)
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
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                                onOpenDeleteAppModal(record as ListAppsItem)
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
            onDeleteFolder,
            onFolderClick,
            onMoveItem,
            onOpenAppOverview,
            onOpenDeleteAppModal,
            onOpenEditAppModal,
            onRenameFolder,
        ],
    )
