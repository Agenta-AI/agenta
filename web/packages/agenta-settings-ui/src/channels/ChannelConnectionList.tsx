import {connectionLabel, installKindLabel, platformLabel} from "./helpers"
import type {ChannelConnection} from "./types"

export interface ChannelConnectionListProps {
    /** This agent's connections on one platform; shown only when there is more than one. */
    connections: ChannelConnection[]
    selectedId: string | null
    hostedHandle?: string
    onSelect: (connectionId: string) => void
}

const formatDate = (iso: string | null | undefined): string | null => {
    if (!iso) return null
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return null
    return date.toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"})
}

/**
 * The switcher above the manage view when an agent answers through several connections on one
 * platform (two Slack workspaces, two Telegram bots). Each row is one connection; the manage
 * view below, and its Disconnect, act on the selected one only.
 */
export const ChannelConnectionList = ({
    connections,
    selectedId,
    hostedHandle,
    onSelect,
}: ChannelConnectionListProps) => {
    const platform = connections[0]?.platform
    if (!platform) return null
    return (
        <div className="mb-5 flex flex-col gap-2" data-testid="channels-connection-list">
            <span className="text-[13px] font-semibold text-colorText">
                {platformLabel(platform)} connections
            </span>
            <div className="overflow-hidden rounded-lg border border-solid border-colorBorderSecondary">
                {connections.map((connection, i) => {
                    const id = connection.connectionId
                    const selected = id === selectedId
                    const revoked = connection.status === "revoked"
                    const kind = installKindLabel(connection)
                    const connectedOn = formatDate(connection.connectedAt)
                    return (
                        <button
                            key={id ?? i}
                            type="button"
                            disabled={!id}
                            aria-pressed={selected}
                            onClick={() => id && onSelect(id)}
                            data-testid={`channels-connection-${id}`}
                            className={`flex w-full cursor-pointer items-center gap-2.5 border-0 px-3 py-2.5 text-left ${
                                i ? "border-t border-solid border-colorBorderSecondary" : ""
                            } ${selected ? "bg-colorFillTertiary" : "bg-transparent"}`}
                        >
                            <span
                                className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                                    revoked ? "bg-colorError" : "bg-colorSuccess"
                                }`}
                            />
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-[13px] text-colorText">
                                    {connectionLabel(connection, hostedHandle)}
                                </span>
                                <span className="truncate text-xs text-colorTextSecondary">
                                    {[kind, connectedOn].filter(Boolean).join(" · ")}
                                </span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
