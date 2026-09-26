import {useState} from "react"

import {Button, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDown, CaretRight, CaretUp, Code, Plus} from "@phosphor-icons/react"

import {ChannelsHubDiagram, type ChannelsHubDiagramTarget} from "./ChannelsHubDiagram"
import {
    CHANNEL_PLATFORMS,
    ROW_BUTTON,
    agentConnectionsOf,
    connectionRowText,
    isLiveForAgent,
    platformLabel,
    summarizeConnection,
} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelConnections, ChannelPlatform} from "./types"

export interface ChannelsHubViewProps {
    agentId?: string
    connections: ChannelConnections
    loading?: boolean
    loadError?: string | null
    onRetry: () => Promise<void>
    /** Lists the API row. */
    showApi: boolean
    apiLive: boolean
    hostedHandle?: string
    /** Opens a platform: connect when nothing answers, else its connection or list. */
    onOpenPlatform: (platform: ChannelPlatform) => void
    onOpenConnection: (platform: ChannelPlatform, connectionId: string) => void
    /** Starts another connection on a platform that already has one. */
    onAdd: (platform: ChannelPlatform) => void
    onOpenApi: () => void
}

/** The Publish panel's first view: where this agent answers, one card per platform, and API. */
export const ChannelsHubView = ({
    agentId,
    connections,
    loading = false,
    loadError = null,
    onRetry,
    showApi,
    apiLive,
    hostedHandle,
    onOpenPlatform,
    onOpenConnection,
    onAdd,
    onOpenApi,
}: ChannelsHubViewProps) => {
    const [expanded, setExpanded] = useState<Partial<Record<ChannelPlatform, boolean>>>({})
    const [retrying, setRetrying] = useState(false)
    const unavailable = loading || !!loadError

    const targets: ChannelsHubDiagramTarget[] = [
        ...CHANNEL_PLATFORMS.map((platform) => ({
            key: platform,
            name: platformLabel(platform),
            icon: platformLogo(platform, 12),
            // Any of the agent's connections, not only the summarized one.
            live: agentConnectionsOf(connections, platform).some((c) => isLiveForAgent(c, agentId)),
        })),
        ...(showApi
            ? [{key: "api", name: "API", icon: <Code size={12} weight="bold" />, live: apiLive}]
            : []),
    ]

    return (
        <div className="flex flex-col gap-4" data-testid="channels-hub">
            <ChannelsHubDiagram agentId={agentId} targets={targets} />

            {loadError ? (
                <div
                    role="alert"
                    className="flex items-center justify-between gap-3 rounded-lg border border-solid border-border px-3 py-2.5 text-[13px] text-error"
                >
                    <span className="min-w-0">{loadError}</span>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={retrying}
                        onClick={async () => {
                            setRetrying(true)
                            try {
                                await onRetry()
                            } catch {
                                // The host keeps the error until a reload succeeds.
                            } finally {
                                setRetrying(false)
                            }
                        }}
                    >
                        {retrying ? "Retrying…" : "Try again"}
                    </Button>
                </div>
            ) : null}

            <div className="flex flex-col gap-2.5">
                {CHANNEL_PLATFORMS.map((platform) => {
                    if (loading) {
                        return (
                            <div
                                key={platform}
                                className="flex items-center gap-3 rounded-lg border border-solid border-border px-3 py-2.5"
                            >
                                <SkeletonBlock active className="size-[34px] rounded-lg" />
                                <div className="flex flex-1 flex-col gap-1.5">
                                    <SkeletonBlock active className="h-3.5 w-20" />
                                    <SkeletonBlock active className="h-3 w-36" />
                                </div>
                            </div>
                        )
                    }
                    const summary = summarizeConnection(platform, connections[platform], agentId)
                    const mine = agentConnectionsOf(connections, platform)
                    const noun =
                        platform === "slack"
                            ? "workspace"
                            : platform === "whatsapp"
                              ? "number"
                              : "bot"
                    const canExpand = mine.length > 0 && !unavailable
                    // Answering as another agent is a choice to make here, so it reads as a warning.
                    const dotClass =
                        summary.action === "connect-here" ? "bg-colorWarning" : summary.dotClass
                    const open = canExpand && !!expanded[platform]
                    const toggle = () => {
                        if (canExpand) setExpanded((e) => ({...e, [platform]: !e[platform]}))
                        else onOpenPlatform(platform)
                    }
                    const sub = loadError
                        ? "Unavailable"
                        : mine.length && summary.action === "manage" && !summary.needsAttention
                          ? `${mine.length} ${noun}${mine.length > 1 ? "s" : ""} connected`
                          : summary.connected || summary.dotClass
                            ? summary.sub
                            : "Not connected"
                    return (
                        <div
                            key={platform}
                            className={`overflow-hidden rounded-lg border border-solid bg-background transition-colors ${
                                open ? "border-ring" : "border-border"
                            }`}
                        >
                            <div
                                className={`flex items-center gap-2 pr-2.5 ${
                                    unavailable ? "" : "hover:bg-accent"
                                }`}
                            >
                                <Button
                                    variant="ghost"
                                    disabled={unavailable}
                                    aria-expanded={canExpand ? open : undefined}
                                    onClick={toggle}
                                    className={`${ROW_BUTTON} min-w-0 flex-1 gap-3 rounded-none py-2.5 pl-3 pr-1 hover:bg-transparent disabled:opacity-100`}
                                    data-testid={`channels-hub-${platform}`}
                                >
                                    <span className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-muted">
                                        {platformLogo(platform, 16)}
                                        {dotClass && !unavailable ? (
                                            <span
                                                className={`absolute -right-[3px] -top-[3px] size-2.5 rounded-full border-2 border-solid border-background ${dotClass}`}
                                            />
                                        ) : null}
                                    </span>
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="text-sm font-medium text-foreground">
                                            {platformLabel(platform)}
                                        </span>
                                        <span
                                            className={`truncate text-[12.5px] ${
                                                summary.needsAttention
                                                    ? summary.subClass
                                                    : "text-muted-foreground"
                                            }`}
                                        >
                                            {sub}
                                        </span>
                                    </span>
                                </Button>
                                {unavailable ? null : (
                                    <Button
                                        variant="outline"
                                        size="xs"
                                        onClick={() => {
                                            if (mine.length) onAdd(platform)
                                            else onOpenPlatform(platform)
                                        }}
                                        data-testid={`channels-hub-add-${platform}`}
                                    >
                                        <Plus weight="bold" data-icon="inline-start" />
                                        {mine.length ? "Add" : "Connect"}
                                    </Button>
                                )}
                                <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={unavailable}
                                    aria-label={canExpand ? (open ? "Collapse" : "Expand") : "Open"}
                                    onClick={toggle}
                                    className={`rounded-full text-muted-foreground ${open ? "bg-muted" : ""}`}
                                >
                                    {canExpand ? (
                                        open ? (
                                            <CaretUp />
                                        ) : (
                                            <CaretDown />
                                        )
                                    ) : (
                                        <CaretRight />
                                    )}
                                </Button>
                            </div>
                            {open ? (
                                <div className="border-0 border-t border-solid border-border px-1.5 pb-1.5 pt-1">
                                    {mine.map((connection) => {
                                        const {title, detail} = connectionRowText(
                                            connection,
                                            hostedHandle,
                                        )
                                        const id = connection.connectionId
                                        return (
                                            <Button
                                                key={id ?? title}
                                                variant="ghost"
                                                disabled={!id}
                                                onClick={() => id && onOpenConnection(platform, id)}
                                                className={`${ROW_BUTTON} w-full gap-2.5 py-2 pl-2.5 pr-2`}
                                                data-testid={`channels-hub-connection-${id}`}
                                            >
                                                <span className="flex size-[22px] flex-none items-center justify-center rounded-md border border-solid border-border bg-muted text-[10.5px] font-semibold text-muted-foreground">
                                                    {title
                                                        .replace(/^@/, "")
                                                        .charAt(0)
                                                        .toUpperCase()}
                                                </span>
                                                <span className="max-w-[50%] flex-none truncate text-[13px] font-medium text-foreground">
                                                    {title}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                                    {detail}
                                                </span>
                                                <span
                                                    className={`size-1.5 flex-none rounded-full ${
                                                        connection.status === "revoked"
                                                            ? "bg-colorError"
                                                            : "bg-colorSuccess"
                                                    }`}
                                                />
                                                <CaretRight
                                                    size={11}
                                                    className="flex-none text-muted-foreground"
                                                />
                                            </Button>
                                        )
                                    })}
                                </div>
                            ) : null}
                        </div>
                    )
                })}

                {showApi ? (
                    <Button
                        variant="outline"
                        onClick={onOpenApi}
                        className={`${ROW_BUTTON} w-full gap-3 rounded-lg py-2.5 pl-3 pr-2.5`}
                        data-testid="channels-hub-api"
                    >
                        <span className="relative flex size-[34px] flex-none items-center justify-center rounded-lg bg-muted text-foreground">
                            <Code size={16} weight="bold" />
                            {apiLive ? (
                                <span className="absolute -right-[3px] -top-[3px] size-2.5 rounded-full border-2 border-solid border-background bg-colorSuccess" />
                            ) : null}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="text-sm font-medium text-foreground">API</span>
                            <span className="truncate text-[12.5px] text-muted-foreground">
                                {apiLive
                                    ? "Always on for saved versions"
                                    : "Save the agent to call it"}
                            </span>
                        </span>
                        <span className="flex size-7 flex-none items-center justify-center text-muted-foreground">
                            <CaretRight size={12} />
                        </span>
                    </Button>
                ) : null}
            </div>
        </div>
    )
}
