import {UserAuthorLabel} from "@agenta/entities/shared/user"
import {createStandardColumns} from "@agenta/ui/table"
import {Note, PencilSimple, Rocket, Trash} from "@phosphor-icons/react"

import {AppNameCell} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

import AgentActivityCell from "./AgentActivityCell"

export interface AgentColumnActions {
    onOpen: (record: AppWorkflowRow) => void
    onOpenPlayground: (record: AppWorkflowRow) => void
    onRename: (record: AppWorkflowRow) => void
    onArchive: (record: AppWorkflowRow) => void
}

/**
 * Columns for the Home "Your agents" table.
 *
 * The roster used to be three provenance columns — created at, last modified, created by — which
 * answered who made this and when, and nothing about whether the agent is doing anything. Sessions
 * are the unit of work, so the table now leads with activity and with what is blocked; "Created at"
 * is gone because "Last modified" already covers it for all but the never-edited agent.
 */
export function createAgentColumns(
    actions: AgentColumnActions,
    waitingByAgent: Map<string, number>,
) {
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
            type: "text",
            key: "lastActivity",
            title: "Last active",
            width: 140,
            render: (_, record) => <AgentActivityCell agentId={record.workflowId} />,
        },
        {
            type: "text",
            key: "waiting",
            title: "Waiting",
            width: 110,
            render: (_, record) => {
                const waiting = waitingByAgent.get(record.workflowId) ?? 0
                if (!waiting) return <span className="text-xs text-colorTextTertiary">—</span>
                return (
                    <span className="rounded bg-colorWarningBg px-1.5 py-0.5 text-xs leading-none text-colorWarningText">
                        {waiting}
                    </span>
                )
            },
        },
        {
            type: "date",
            key: "updatedAt",
            title: "Last modified",
            width: 200,
        },
        {
            type: "text",
            key: "createdById",
            title: "Created by",
            width: 160,
            render: (_, record) => (
                <div className="h-full shrink-0 flex items-center">
                    <UserAuthorLabel
                        userId={record.createdById}
                        showPrefix={false}
                        showAvatar
                        showYouLabel
                        fallback="—"
                        className="shrink-0"
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
                {
                    key: "rename",
                    label: "Rename",
                    icon: <PencilSimple size={16} />,
                    onClick: (record) => actions.onRename(record),
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
