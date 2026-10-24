import {Alert, Button} from "@agenta/ui/ui"
import {CaretRight, LockSimple, Users} from "@phosphor-icons/react"

import {AgentMark} from "./AgentMark"
import {liveCountOf, platformLabel, ROW_BUTTON} from "./helpers"
import {channelSharingCopy as copy} from "./sharingCopy"
import type {ChannelConnections, ChannelPlatform, ChannelsPanelAgent} from "./types"

export interface ChannelAgentPickerProps {
    agents: ChannelsPanelAgent[]
    connections: ChannelConnections
    onSelect: (agentId: string) => void
    /** The platform being connected; the audience note names it. No note without it. */
    platform?: ChannelPlatform
    /** The project's name, for the audience note. No note without it. */
    projectName?: string
    /** Opens "Privacy and owner" for one of the reader's private agents. No link without it. */
    onShareAgent?: (agentId: string) => void
}

/** The first step of a connection made outside an agent's page: which agent answers there. */
export const ChannelAgentPicker = ({
    agents,
    connections,
    onSelect,
    platform,
    projectName,
    onShareAgent,
}: ChannelAgentPickerProps) => {
    // A private agent cannot answer a channel: the reader's own are listed last, not clickable.
    const open = agents.filter((agent) => !agent.isPrivate)
    const closed = agents.filter((agent) => agent.isPrivate)
    const label = platform ? platformLabel(platform) : null

    return (
        <div className="flex flex-col gap-2.5" data-testid="channels-agent-picker">
            {label && projectName ? (
                <Alert
                    type="info"
                    showIcon
                    role="note"
                    icon={<Users />}
                    message={copy.audienceNote(projectName, label)}
                    data-testid="channels-picker-audience"
                />
            ) : null}
            <span className="px-0.5 text-[13px] font-semibold text-foreground">Agents</span>
            {agents.length ? (
                <div className="flex flex-col">
                    {open.map((agent) => {
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
                    {closed.map((agent) => (
                        <div
                            key={agent.id}
                            aria-disabled="true"
                            data-testid={`channels-agent-${agent.id}`}
                            data-private="true"
                            className="flex w-full items-center gap-3 px-1 py-3"
                        >
                            <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                <LockSimple size={13} aria-hidden />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="truncate text-sm font-medium text-muted-foreground">
                                    {agent.name}
                                </span>
                                <span className="text-[12.5px] text-muted-foreground">
                                    {copy.privateAgentRow(label ?? platformLabel("slack"))}
                                </span>
                            </span>
                            {onShareAgent ? (
                                <Button
                                    variant="link"
                                    size="xs"
                                    onClick={() => onShareAgent(agent.id)}
                                    data-testid={`channels-agent-share-${agent.id}`}
                                >
                                    {copy.share}
                                </Button>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="m-0 px-0.5 text-sm text-muted-foreground">
                    This project has no agents yet. Create one, then connect it here.
                </p>
            )}
        </div>
    )
}
