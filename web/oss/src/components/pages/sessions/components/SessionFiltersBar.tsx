import {MagnifyingGlassIcon} from "@phosphor-icons/react"
import {Input, Segmented, Select, Switch, Tooltip} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {agentsWorkflowsAtom} from "../../agents/store"
import {
    sessionAgentFilterAtom,
    sessionSearchAtom,
    sessionShowArchivedAtom,
    sessionShowTriggeredAtom,
    sessionStatusFilterAtom,
    type SessionStatusFilter,
} from "../state/filters"

interface Props {
    waitingCount: number | undefined
    /** The agent-scoped page fixes the agent from the route, so the picker would only lie. */
    hideAgentFilter?: boolean
}

/** Every control here maps to a server predicate — see `useSessionList`. */
const SessionFiltersBar = ({waitingCount, hideAgentFilter}: Props) => {
    const [search, setSearch] = useAtom(sessionSearchAtom)
    const [agentId, setAgentId] = useAtom(sessionAgentFilterAtom)
    const [status, setStatus] = useAtom(sessionStatusFilterAtom)
    const [showArchived, setShowArchived] = useAtom(sessionShowArchivedAtom)
    const [showTriggered, setShowTriggered] = useAtom(sessionShowTriggeredAtom)
    const agents = useAtomValue(agentsWorkflowsAtom)

    return (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
            <Input
                allowClear
                value={search}
                placeholder="Search sessions"
                prefix={<MagnifyingGlassIcon size={14} className="text-colorTextTertiary" />}
                onChange={(event) => setSearch(event.target.value)}
                className="w-64"
            />

            {hideAgentFilter ? null : (
                <Select
                    allowClear
                    value={agentId}
                    onChange={(value) => setAgentId(value ?? null)}
                    placeholder="All agents"
                    className="w-48"
                    options={agents.map((agent) => ({
                        value: agent.workflowId,
                        label: agent.name,
                    }))}
                />
            )}

            <Segmented<SessionStatusFilter>
                value={status}
                onChange={setStatus}
                options={[
                    {value: "all", label: "All"},
                    {value: "live", label: "Live"},
                    {
                        value: "waiting",
                        label: waitingCount ? `Waiting ${waitingCount}` : "Waiting",
                    },
                ]}
            />

            <Tooltip title="Sessions started by an automation, not by you">
                <label className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Switch checked={showTriggered} onChange={setShowTriggered} />
                    Show automations
                </label>
            </Tooltip>

            <Tooltip title="Archived sessions are hidden but recoverable">
                <label className="flex items-center gap-2 text-xs text-colorTextSecondary">
                    <Switch checked={showArchived} onChange={setShowArchived} />
                    Show archived
                </label>
            </Tooltip>
        </div>
    )
}

export default SessionFiltersBar
