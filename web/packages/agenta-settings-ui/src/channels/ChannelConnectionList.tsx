import {useT} from "@agenta/i18n"
import channelsListCatalog from "@agenta/i18n/catalogs/channels.list"
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
    const t = useT(channelsListCatalog)
    const isSlack = platform === "slack"
    const hostedHere = connections.some((c) => c.kind === "hosted")
    const empty = connections.length === 0
    return (
        <div className="flex flex-col gap-2.5" data-testid="channels-connection-list">
            <div className="flex items-baseline justify-between px-0.5">
                <span className="text-label font-semibold text-foreground">
                    {isSlack
                        ? t("channels.list.workspaces")
                        : platform === "whatsapp"
                          ? t("channels.list.numbers")
                          : t("channels.list.bots")}
                </span>
                <span className="text-label text-muted-foreground">
                    {t("channels.list.connectedCount", {count: connections.length})}
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
                            className={`${ROW_BUTTON} box-border min-h-row-double w-full gap-3 px-1 py-1`}
                        >
                            <span className="flex size-8 flex-none items-center justify-center rounded-md bg-secondary text-label font-semibold text-muted-foreground">
                                {title.replace(/^@/, "").charAt(0).toUpperCase()}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-px">
                                <span className="truncate text-label text-foreground">{title}</span>
                                <span className="truncate text-meta text-muted-foreground">
                                    {detail}
                                </span>
                            </span>
                            <span
                                className={`size-1.5 flex-none rounded-round ${
                                    connection.status === "revoked"
                                        ? "bg-destructive"
                                        : "bg-success"
                                }`}
                            />
                            <CaretRight size={12} className="flex-none text-muted-foreground" />
                        </Button>
                    )
                })}
                <Button
                    variant="ghost"
                    onClick={onAdd}
                    className={`${ROW_BUTTON} box-border min-h-row-double w-full gap-3 px-1 py-1 text-muted-foreground`}
                    data-testid="channels-connection-add"
                >
                    <span className="flex size-8 flex-none items-center justify-center rounded-md bg-muted">
                        <Plus size={14} />
                    </span>
                    <span className="text-body">
                        {isSlack
                            ? t(empty ? "channels.list.addFirstWorkspace" : "channels.list.addWorkspace")
                            : platform === "whatsapp"
                              ? t(empty ? "channels.list.addFirstNumber" : "channels.list.addNumber")
                              : hostedHere
                                ? t("channels.list.addOwnBot")
                                : t("channels.list.addBot")}
                    </span>
                </Button>
            </div>
        </div>
    )
}
