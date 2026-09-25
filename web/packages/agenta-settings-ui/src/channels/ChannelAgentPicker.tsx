import {Button} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"

import {AgentMark} from "./AgentMark"
import {liveCountOf, ROW_BUTTON} from "./helpers"
import type {ChannelConnections, ChannelsPanelAgent} from "./types"

export interface ChannelAgentPickerProps {
    agents: ChannelsPanelAgent[]
    connections: ChannelConnections
    onSelect: (agentId: string) => void
}

/** The first step of a connection made outside an agent's page: which agent answers there. */
export const ChannelAgentPicker = ({agents, connections, onSelect}: ChannelAgentPickerProps) => (
    <div className="flex flex-col gap-2.5" data-testid="channels-agent-picker">
        <span className="px-0.5 text-[13px] font-semibold text-foreground">Agents</span>
        {agents.length ? (
            <div className="flex flex-col">
                {agents.map((agent) => {
                    const live = liveCountOf(connections, agent.id)
                    return (
                        <Button
                            key={agent.id}
                            variant="ghost"
                            onClick={() => onSelect(agent.id)}
                            data-testid={`channels-agent-${agent.id}`}
                            className={`${ROW_BUTTON} w-full gap-3 px-1 py-3`}
                        >
                            <AgentMark agentId={agent.id} />
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="truncate text-sm font-medium text-foreground">
                                    {agent.name}
                                </span>
                                <span className="truncate text-[12.5px] text-muted-foreground">
                                    {live
                                        ? `${live} channel${live > 1 ? "s" : ""} live`
                                        : "No channels yet"}
                                </span>
                            </span>
                            <CaretRight size={12} className="flex-none text-muted-foreground" />
                        </Button>
                    )
                })}
            </div>
        ) : (
            <p className="m-0 px-0.5 text-sm text-muted-foreground">
                This project has no agents yet. Create one, then connect it here.
            </p>
        )}
    </div>
)
