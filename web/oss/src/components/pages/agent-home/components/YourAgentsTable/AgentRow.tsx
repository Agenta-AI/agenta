import {DotsThreeIcon, Note, PencilSimple, Rocket, Trash} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"

import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

import AgentActivityCell from "./AgentActivityCell"
import type {AgentColumnActions} from "./columns"

/**
 * One agent as a rail row.
 *
 * The roster's five columns — name, last active, waiting, last modified, created by — cannot
 * coexist in a 340px column; the table simply scrolled sideways, which is how "Waiting" ended up
 * rendering as "iting". A row keeps the two operational facts (is anything blocked, when did it
 * last run) and drops the provenance ones: who created it and when it was last edited are
 * questions for the agent's own page, not for a roster you scan.
 */
const AgentRow = ({
    record,
    waiting,
    actions,
}: {
    record: AppWorkflowRow
    waiting: number
    actions: AgentColumnActions
}) => (
    <div
        role="button"
        tabIndex={0}
        onClick={() => actions.onOpenPlayground(record)}
        onKeyDown={(event) => {
            // Only the row itself: the kebab inside it handles its own keys, and Space on a
            // container that does not preventDefault also scrolls the page.
            if (event.target !== event.currentTarget) return
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            actions.onOpenPlayground(record)
        }}
        className="group box-border flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-2 py-2.5 text-left hover:bg-colorFillQuaternary"
    >
        <span className="min-w-0 flex-1 truncate text-sm text-colorText">{record.name}</span>

        {waiting > 0 ? (
            <span className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-xs leading-none text-colorWarningText">
                {waiting}
            </span>
        ) : null}

        <span className="w-16 shrink-0 text-right">
            <AgentActivityCell agentId={record.workflowId} />
        </span>

        <Dropdown
            trigger={["click"]}
            menu={{
                items: [
                    {
                        key: "open_overview",
                        label: "Open overview",
                        icon: <Note size={16} />,
                        onClick: () => actions.onOpen(record),
                    },
                    {
                        key: "open_playground",
                        label: "Open in playground",
                        icon: <Rocket size={16} />,
                        onClick: () => actions.onOpenPlayground(record),
                    },
                    {
                        key: "rename",
                        label: "Rename",
                        icon: <PencilSimple size={16} />,
                        onClick: () => actions.onRename(record),
                    },
                    {type: "divider"},
                    {
                        key: "archive",
                        label: "Archive",
                        icon: <Trash size={16} />,
                        danger: true,
                        onClick: () => actions.onArchive(record),
                    },
                ],
            }}
        >
            <Button
                type="text"
                aria-label="Agent actions"
                className="shrink-0"
                icon={<DotsThreeIcon size={14} />}
                onClick={(event) => event.stopPropagation()}
            />
        </Dropdown>
    </div>
)

export default AgentRow
