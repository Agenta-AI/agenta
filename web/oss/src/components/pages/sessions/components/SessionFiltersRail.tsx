import {useSessionFilters} from "@agenta/sessions/state"
import {
    SessionArchivedControl,
    SessionModeControl,
    SessionSearchControl,
    SessionStatusListControl,
} from "@agenta/sessions-ui"
import {Select, Typography} from "antd"
import {useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "../../agents/store"

const RailLabel = ({children}: {children: React.ReactNode}) => (
    <h2 className="m-0 text-[11px] font-semibold uppercase tracking-wide text-colorTextTertiary">
        {children}
    </h2>
)

interface Props {
    title: string
    waitingCount: number | undefined
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
}

/**
 * The session filters as a rail — the SHELL. The controls themselves come from
 * `@agenta/sessions-ui` and bind to the shared filter atoms, so this file owns only the 280px
 * column, the group labels, and the agent picker (antd `Select`, which stays app-injected until
 * the EntityPicker migrates off antd).
 */
const SessionFiltersRail = ({title, waitingCount, hideAgentFilter}: Props) => {
    const {agentId, setAgentId} = useSessionFilters()
    const agents = useAtomValue(agentsWorkflowsAtom)

    return (
        <aside className="box-border flex w-full shrink-0 flex-col gap-6 overflow-y-auto border-0 border-solid border-colorBorderSecondary px-6 py-6 lg:w-[280px] lg:border-r lg:bg-colorFillQuaternary">
            <Typography.Title level={2} className="!m-0 !text-[24px] !leading-tight">
                {title}
            </Typography.Title>

            <SessionSearchControl />

            <SessionStatusListControl waitingCount={waitingCount} />

            {hideAgentFilter ? null : (
                <section className="flex flex-col gap-2">
                    <RailLabel>Agent</RailLabel>
                    <Select
                        allowClear
                        value={agentId}
                        onChange={(value) => setAgentId(value ?? null)}
                        placeholder="All agents"
                        options={agents.map((agent) => ({
                            value: agent.workflowId,
                            label: agent.name,
                        }))}
                    />
                </section>
            )}

            {/* Two different kinds of switch, so two headings: one picks WHICH sessions, the
                other widens the set. Under one "Include" label they read as the same thing. */}
            <section className="flex flex-col gap-3">
                <RailLabel>Show</RailLabel>
                <SessionModeControl />
            </section>

            <section className="flex flex-col gap-3">
                <RailLabel>Include</RailLabel>
                <SessionArchivedControl />
            </section>
        </aside>
    )
}

export default SessionFiltersRail
