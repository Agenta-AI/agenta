import {PlusIcon} from "@phosphor-icons/react"
import {Empty, Skeleton} from "antd"

import AgentCard from "@/oss/components/AgentCard"
import type {AgentColumnActions} from "@/oss/components/pages/agent-home/components/YourAgentsTable/columns"
import {useWaitingByAgent} from "@/oss/components/pages/agent-home/components/YourAgentsTable/useAgentActivity"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

/**
 * The agents roster as a card grid.
 *
 * The table it replaces put five columns behind a horizontal scroll, so reading an agent meant
 * scrolling sideways past provenance to reach whether anything is blocked. A card is one agent at
 * a glance, and the create affordance is the grid's last cell rather than a control set apart from
 * the things it creates.
 */
const AgentsGrid = ({
    rows,
    isLoading,
    actions,
    onCreate,
}: {
    rows: AppWorkflowRow[]
    isLoading: boolean
    actions: AgentColumnActions
    onCreate: () => void
}) => {
    const waitingByAgent = useWaitingByAgent()

    if (isLoading && rows.length === 0) {
        return <Skeleton active paragraph={{rows: 6}} title={false} />
    }

    // `pt-5` is the room the grid variant's overhanging avatar needs. It belongs to the grid, not
    // to each card — on the card it left the avatar-less dashed cell misaligned.
    return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-4 gap-y-10 pt-5">
            {rows.map((record) => (
                <AgentCard
                    key={record.key}
                    variant="grid"
                    record={record}
                    waiting={waitingByAgent.get(record.workflowId) ?? 0}
                    actions={actions}
                />
            ))}

            {/* Dashed, so it reads as a slot to fill rather than an agent that exists. */}
            <button
                type="button"
                onClick={onCreate}
                className="box-border flex h-full min-h-[132px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-colorBorder bg-transparent p-4 text-center transition-colors hover:border-colorPrimary"
            >
                <PlusIcon size={18} className="text-colorTextTertiary" />
                <span className="text-sm text-colorText">New agent</span>
                <span className="text-xs text-colorTextTertiary">blank or from a template</span>
            </button>

            {!isLoading && rows.length === 0 ? (
                <div className="col-span-full">
                    <Empty description="No agents yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </div>
            ) : null}
        </div>
    )
}

export default AgentsGrid
