import {PlusOutlined, RobotOutlined} from "@ant-design/icons"
import {Button, Input, Typography} from "antd"
import {useAtomValue} from "jotai"
import {useDeferredValue, useState} from "react"

import {agentsQueryAtom} from "@/lib/state/agents"

import {AgentRevisionBadge} from "./AgentRevisionBadge"
import {AgentListEmpty} from "./states/AgentListEmpty"
import {AgentListError} from "./states/AgentListError"
import {AgentListSkeleton} from "./states/AgentListSkeleton"

export const AgentList = ({
    selectedId,
    select,
}: {
    selectedId?: string
    select: (id?: string) => void
}) => {
    const agents = useAtomValue(agentsQueryAtom)
    const [filter, setFilter] = useState("")
    const deferredFilter = useDeferredValue(filter.trim().toLowerCase())

    if (agents.isPending) return <AgentListSkeleton />
    if (agents.isError) return <AgentListError retry={() => void agents.refetch()} />
    if (!agents.data.length) return <AgentListEmpty create={() => select()} />

    const filtered = agents.data.filter((agent) =>
        agent.name.toLowerCase().includes(deferredFilter),
    )
    return (
        <div className="entity-list-wrap">
            <div className="entity-list-head">
                <div>
                    <Typography.Title level={4}>Agents</Typography.Title>
                    <span>{agents.data.length}</span>
                </div>
                <Button
                    type="text"
                    icon={<PlusOutlined />}
                    aria-label="Create agent"
                    onClick={() => select()}
                />
            </div>
            <Input.Search
                allowClear
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Find an agent"
            />
            <div className="entity-list" role="listbox" aria-label="Agents">
                {filtered.map((agent) => (
                    <button
                        key={agent.id}
                        type="button"
                        role="option"
                        aria-selected={agent.id === selectedId}
                        className={agent.id === selectedId ? "entity-row active" : "entity-row"}
                        onClick={() => select(agent.id)}
                    >
                        <span className="entity-avatar">
                            <RobotOutlined />
                        </span>
                        <span className="entity-copy">
                            <strong>{agent.name}</strong>
                            <small>{agent.current_revision.model.name}</small>
                        </span>
                        <AgentRevisionBadge version={agent.current_revision.version} />
                    </button>
                ))}
            </div>
        </div>
    )
}
