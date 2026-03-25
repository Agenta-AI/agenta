import {createStandardColumns} from "@agenta/ui/table"
import {Note, Trash} from "@phosphor-icons/react"
import {Tag} from "antd"

import {getAppTypeIcon} from "../../prompts/assets/iconHelpers"
import type {AppWorkflowRow} from "../store"

export interface AppWorkflowColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onDelete: (record: AppWorkflowRow) => void
}

export function createAppWorkflowColumns(actions: AppWorkflowColumnActions) {
    return createStandardColumns<AppWorkflowRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            render: (_, record) => (
                <div className="h-full flex items-center gap-2 truncate">
                    <span className="flex-shrink-0 flex items-center text-gray-400">
                        {getAppTypeIcon(record.appType)}
                    </span>
                    <span className="truncate">{record.name}</span>
                </div>
            ),
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created At",
        },
        {
            type: "text",
            key: "appType",
            title: "Type",
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <Tag variant="filled">{record.appType}</Tag>
                </div>
            ),
        },
        {
            type: "actions",
            items: [
                {
                    key: "open_app",
                    label: "Open",
                    icon: <Note size={16} />,
                    onClick: (record) => actions.onOpen(record),
                },
                {type: "divider"},
                {
                    key: "delete_app",
                    label: "Delete",
                    icon: <Trash size={16} />,
                    danger: true,
                    onClick: (record) => actions.onDelete(record),
                },
            ],
            showCopyId: false,
        },
    ])
}
