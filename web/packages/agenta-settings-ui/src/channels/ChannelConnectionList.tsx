import {Button} from "@agenta/ui/ui"
import {CaretRight, Plus} from "@phosphor-icons/react"

import {ROW_BUTTON, connectionRowText} from "./helpers"
import type {ChannelConnection, ChannelPlatform} from "./types"

export interface ChannelConnectionListProps {
    platform: ChannelPlatform
    /** This agent's connections on the platform. */
    connections: ChannelConnection[]
    hostedHandle?: string
    onSelect: (connectionId: string) => void
    onAdd: () => void
}

/** Every workspace or bot this agent answers through on one platform, and a way to add one. */
export const ChannelConnectionList = ({
    platform,
    connections,
    hostedHandle,
    onSelect,
    onAdd,
}: ChannelConnectionListProps) => {
    const isSlack = platform === "slack"
    const hostedHere = connections.some((c) => c.kind === "hosted")
    return (
        <div className="flex flex-col gap-2.5" data-testid="channels-connection-list">
            <div className="flex items-baseline justify-between px-0.5">
                <span className="text-[13px] font-semibold text-foreground">
                    {isSlack ? "Workspaces" : platform === "whatsapp" ? "Numbers" : "Bots"}
                </span>
                <span className="text-[12.5px] text-muted-foreground">
                    {connections.length} connected
                </span>
            </div>
            <div className="flex flex-col">
                {connections.map((connection, i) => {
                    const id = connection.connectionId
                    const {title, detail} = connectionRowText(connection, hostedHandle)
                    return (
                        <Button
                            key={id ?? i}
                            variant="ghost"
                            disabled={!id}
                            onClick={() => id && onSelect(id)}
                            data-testid={`channels-connection-${id}`}
                            className={`${ROW_BUTTON} w-full gap-3 rounded-none border-0 border-b border-solid border-border px-1 py-3`}
                        >
                            <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-muted text-[13px] font-semibold text-muted-foreground">
                                {title.replace(/^@/, "").charAt(0).toUpperCase()}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="truncate text-sm font-medium text-foreground">
                                    {title}
                                </span>
                                <span className="truncate text-[12.5px] text-muted-foreground">
                                    {detail}
                                </span>
                            </span>
                            <span
                                className={`size-1.5 flex-none rounded-full ${
                                    connection.status === "revoked"
                                        ? "bg-colorError"
                                        : "bg-colorSuccess"
                                }`}
                            />
                            <CaretRight size={12} className="flex-none text-muted-foreground" />
                        </Button>
                    )
                })}
                <Button
                    variant="ghost"
                    onClick={onAdd}
                    className={`${ROW_BUTTON} w-full gap-3 px-1 py-3 text-muted-foreground`}
                    data-testid="channels-connection-add"
                >
                    <span className="flex size-8 flex-none items-center justify-center rounded-lg border border-dashed border-border">
                        <Plus size={14} />
                    </span>
                    <span className="text-sm">
                        {isSlack
                            ? "Add another workspace"
                            : platform === "whatsapp"
                              ? "Add another number"
                              : hostedHere
                                ? "Add your own bot"
                                : "Add a bot"}
                    </span>
                </Button>
            </div>
        </div>
    )
}
