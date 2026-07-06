import {createStandardColumns} from "@agenta/ui/table"
import {Note, Rocket} from "@phosphor-icons/react"

import {
    AppNameCell,
    AppTypeCell,
} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

export interface AgentColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onOpenPlayground: (record: AppWorkflowRow) => void
}

/** Lean read-only columns for the Home "Your agents" table: name + created + type. */
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
            key: "createdAt",
            title: "Created At",
            width: 220,
        },
        {
            type: "text",
            key: "appType",
            title: "Type",
            width: 160,
            render: (_, record) => (
                <div className="h-full flex items-center">
                    <AppTypeCell workflowId={record.workflowId} />
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
            ],
            showCopyId: false,
        },
    ])
}
