import {createStandardColumns} from "@agenta/ui/table"
import {FolderFilled} from "@ant-design/icons"
import {FolderDashed, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Tag} from "antd"

import {AppNameCell, AppTypeCell} from "../../app-management/components/appWorkflowColumns"
import type {AppTreeNode, FolderTreeNode} from "../assets/utils"
import type {PromptsTableRow} from "../types"

export interface PromptsColumnActions {
    onFolderClick: (folder: FolderTreeNode) => void
    onRenameFolder: (folderId: string) => void
    onDeleteFolder: (folderId: string) => void
    onMoveItem: (item: PromptsTableRow) => void
    onOpenAppOverview: (workflowId: string) => void
    onRenameApp: (record: PromptsTableRow) => void
    onDeleteApp: (record: PromptsTableRow) => void
}

/**
 * The row menu traps the focus until it has closed, and an antd dialog traps it too. A dialog
 * opened from the menu's click handler made the two move the focus back and forth without end
 * ("Maximum call stack size exceeded"). So the menu items that open an antd dialog wait one tick,
 * until the menu has closed. A timeout, because the menu lives in `@agenta/ui` and gives no close
 * callback per item. The app Rename and Archive dialogs do not show the loop, so they open
 * directly.
 */
const afterMenuCloses = (openDialog: () => void) => {
    setTimeout(openDialog, 0)
}

export function createPromptsColumns(actions: PromptsColumnActions) {
    return createStandardColumns<PromptsTableRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            width: 420,
            render: (_, record) => {
                if (record.type === "folder") {
                    return (
                        <div className="h-full flex items-center gap-2 truncate">
                            <span className="flex-shrink-0 flex items-center text-gray-400">
                                <FolderFilled
                                    style={{fontSize: 16, color: "var(--ag-colorTextQuaternary)"}}
                                />
                            </span>
                            <span className="truncate">{record.name}</span>
                        </div>
                    )
                }
                return (
                    <AppNameCell
                        workflowId={(record as AppTreeNode).workflowId}
                        name={record.name}
                    />
                )
            },
        },
        {
            type: "date",
            key: "updatedAt",
            title: "Date modified",
        },
        {
            type: "text",
            key: "type",
            title: "Type",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    {record.type === "folder" ? (
                        <Tag variant="filled">Folder</Tag>
                    ) : (
                        <AppTypeCell workflowId={(record as AppTreeNode).workflowId} />
                    )}
                </div>
            ),
        },
        {
            type: "actions",
            showCopyId: false,
            items: [
                // Folder actions
                {
                    key: "open_folder",
                    label: "Open",
                    icon: <Note size={16} />,
                    onClick: (record) => actions.onFolderClick(record as FolderTreeNode),
                    hidden: (record) => record.type !== "folder",
                },
                {
                    key: "rename_folder",
                    label: "Rename",
                    icon: <PencilSimple size={16} />,
                    onClick: (record) =>
                        afterMenuCloses(() => actions.onRenameFolder(record.id as string)),
                    hidden: (record) => record.type !== "folder",
                },
                {
                    key: "move_folder",
                    label: "Move",
                    icon: <FolderDashed size={16} />,
                    onClick: (record) => afterMenuCloses(() => actions.onMoveItem(record)),
                    hidden: (record) => record.type !== "folder",
                },
                {
                    type: "divider",
                    hidden: (record) => record.type !== "folder",
                },
                {
                    key: "delete_folder",
                    label: "Delete",
                    icon: <Trash size={16} />,
                    danger: true,
                    onClick: (record) =>
                        afterMenuCloses(() => actions.onDeleteFolder(record.id as string)),
                    hidden: (record) => record.type !== "folder",
                },
                // App actions
                {
                    key: "open_app",
                    label: "Open",
                    icon: <Note size={16} />,
                    onClick: (record) =>
                        actions.onOpenAppOverview((record as AppTreeNode).workflowId),
                    hidden: (record) => record.type === "folder",
                },
                {
                    key: "rename_app",
                    label: "Rename",
                    icon: <PencilSimple size={16} />,
                    onClick: (record) => actions.onRenameApp(record),
                    hidden: (record) => record.type === "folder",
                },
                {
                    key: "move_app",
                    label: "Move",
                    icon: <FolderDashed size={16} />,
                    onClick: (record) => afterMenuCloses(() => actions.onMoveItem(record)),
                    hidden: (record) => record.type === "folder",
                },
                {
                    type: "divider",
                    hidden: (record) => record.type === "folder",
                },
                {
                    key: "delete_app",
                    label: "Archive",
                    icon: <Trash size={16} />,
                    danger: true,
                    onClick: (record) => actions.onDeleteApp(record),
                    hidden: (record) => record.type === "folder",
                },
            ],
        },
    ])
}
