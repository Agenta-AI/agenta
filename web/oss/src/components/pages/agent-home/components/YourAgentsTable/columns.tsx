import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {createStandardColumns} from "@agenta/ui/table"
import {Note, Rocket, Trash} from "@phosphor-icons/react"

import {AppNameCell} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

export interface AgentColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onOpenPlayground: (record: AppWorkflowRow) => void
    onArchive: (record: AppWorkflowRow) => void
}

/** Lean read-only columns for the Home "Your agents" table: name + creator + dates. */
export function createAgentColumns(actions: AgentColumnActions) {
    return createStandardColumns<AppWorkflowRow>([
        {
            type: "text",
            key: "name",
            title: "Name",
            render: (_, record) => (
                <AppNameCell workflowId={record.workflowId} name={record.name} />
            ),
        },
        {
            type: "date",
            key: "updatedAt",
            title: "Last modified",
            width: 220,
        },
        {
            type: "date",
            key: "createdAt",
            title: "Created at",
            width: 220,
        },
        {
            type: "text",
            key: "createdById",
            title: "Created by",
            width: 160,
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <UserAuthorLabel
                        userId={record.createdById}
                        showPrefix={false}
                        showAvatar
                        showYouLabel
                        fallback="—"
                    />
                </div>
            ),
        },
        {
            type: "actions",
            items: [
                {
                    key: "open_overview",
                    label: "Open overview",
                    icon: <Note size={16} />,
                    onClick: (record) => actions.onOpen(record),
                },
                {
                    key: "open_playground",
                    label: "Open in playground",
                    icon: <Rocket size={16} />,
                    onClick: (record) => actions.onOpenPlayground(record),
                },
                {type: "divider"},
                {
                    key: "archive",
                    label: "Archive",
                    icon: <Trash size={16} />,
                    danger: true,
                    onClick: (record) => actions.onArchive(record),
                },
            ],
            showCopyId: false,
        },
    ])
}
