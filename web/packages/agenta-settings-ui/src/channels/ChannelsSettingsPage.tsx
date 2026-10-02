import {useMemo, useRef, useState} from "react"

import {
    Button,
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Input,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {MagnifyingGlass, Plus} from "@phosphor-icons/react"

import {connectionsForAgent} from "./actions"
import {ChannelConnectionCard} from "./ChannelConnectionCard"
import {
    CHANNEL_PLATFORMS,
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    connectionRowText,
    platformLabel,
} from "./helpers"
import {platformLogo} from "./icons"
import type {
    ChannelConnection,
    ChannelConnections,
    ChannelsActions,
    ChannelsPanelAgent,
} from "./types"
import {useChannelPanel, type ChannelsPanelRenderProps} from "./useChannelPanel"

export interface ChannelsSettingsPageProps {
    /** The project's agents: the ones a connection can answer as. */
    agents: ChannelsPanelAgent[]
    /** The agent the panel acts for; `actions` must be built for it. */
    agentId?: string
    /** Switch the agent the panel acts for; the host rebuilds `actions` for it. */
    onAgentChange: (agentId: string) => void
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    /** The project's connections, as loaded by the host (`allConnections` lists them all). */
    connections?: ChannelConnections
    /** True while the host loads `connections` for the first time. */
    loading?: boolean
    loadError?: string | null
    onRetry: () => Promise<void>
    actions?: ChannelsActions
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    hostedHandle?: string
}

const CARD_GRID = "grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4"

/**
 * Settings > Channels: every connection in the project, whichever agent it answers as. A card
 * opens the Publish panel on its connection; a new connection starts by choosing the agent.
 */
export const ChannelsSettingsPage = ({
    agents,
    agentId,
    onAgentChange,
    agentDescription,
    workspaceName,
    connections = EMPTY_CONNECTIONS,
    loading = false,
    loadError = null,
    onRetry,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
}: ChannelsSettingsPageProps) => {
    const [retrying, setRetrying] = useState(false)
    const [search, setSearch] = useState("")
    const searchRef = useRef<HTMLInputElement>(null)
    const all = connections.allConnections ?? []
    const term = search.trim().toLowerCase()
    const shown = term
        ? all.filter((connection) => {
              const {title, detail} = connectionRowText(connection, hostedHandle)
              return [title, detail, platformLabel(connection.platform), connection.agent?.name]
                  .filter(Boolean)
                  .some((text) => text!.toLowerCase().includes(term))
          })
        : all
    const agentName = agents.find((agent) => agent.id === agentId)?.name

    // The panel's agent changes before the host reloads for it, so derive its view here.
    const forAgent = useMemo(
        () =>
            agentId && connections.allConnections
                ? connectionsForAgent(connections.allConnections, agentId)
                : connections,
        [connections, agentId],
    )

    const firstLoad = loading && !connections.allConnections

    const panel = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        workspaceName,
        connections: forAgent,
        // A switch of agent reloads too, but `forAgent` already holds that agent's view.
        loading: firstLoad,
        loadError,
        actions,
        renderPanel,
        hostedHandle,
        agents,
        onAgentChange,
    })

    const openConnection = (connection: ChannelConnection) => {
        const owner = connection.agent?.id
        // No known owner: ask which agent, rather than act for whichever was picked last.
        if (!owner || !agents.some((agent) => agent.id === owner)) {
            panel.openRoute({view: "agents"})
            return
        }
        if (owner !== agentId) onAgentChange(owner)
        panel.openConnection(connection)
    }
    const startConnect = () => panel.openRoute({view: "agents"})

    const retry = async () => {
        setRetrying(true)
        try {
            await onRetry()
        } catch {
            // The host keeps the error until a reload succeeds.
        } finally {
            setRetrying(false)
        }
    }

    return (
        <div className="flex flex-col gap-4" data-testid="channels-settings">
            {loadError ? (
                <div
                    role="alert"
                    className="flex items-center justify-between gap-3 rounded-lg border border-solid border-border px-3 py-2.5 text-[13px] text-error"
                >
                    <span className="min-w-0">{loadError}</span>
                    <Button variant="outline" size="sm" disabled={retrying} onClick={retry}>
                        {retrying ? "Retrying…" : "Try again"}
                    </Button>
                </div>
            ) : null}

            {firstLoad ? (
                <div className={CARD_GRID}>
                    {[0, 1, 2].map((i) => (
                        <SkeletonBlock key={i} active className="h-[200px] rounded-lg" />
                    ))}
                </div>
            ) : all.length === 0 ? (
                loadError ? null : (
                    <Empty className="rounded-lg border border-border py-14">
                        <EmptyHeader>
                            <EmptyMedia className="flex gap-2">
                                {CHANNEL_PLATFORMS.map((platform) => (
                                    <span
                                        key={platform}
                                        className="flex size-11 items-center justify-center rounded-[10px] bg-muted"
                                    >
                                        {platformLogo(platform, 22)}
                                    </span>
                                ))}
                            </EmptyMedia>
                            <EmptyTitle>No channels connected</EmptyTitle>
                            <EmptyDescription>
                                Connect Slack, Telegram or WhatsApp and pick the agent that answers
                                there. Your team can then talk to it without opening Agenta.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button onClick={startConnect} data-testid="channels-settings-connect">
                                <Plus data-icon="inline-start" />
                                Connect channel
                            </Button>
                        </EmptyContent>
                    </Empty>
                )
            ) : (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        {/* The same search box as the other Settings tables. */}
                        <div className="flex w-full sm:w-[260px]">
                            <Input
                                ref={searchRef}
                                placeholder="Search channels"
                                className="min-w-0 flex-1 rounded-r-none"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                data-testid="channels-settings-search"
                            />
                            <Button
                                variant="outline"
                                aria-label="Search channels"
                                className="-ml-px h-auto w-7 shrink-0 self-stretch rounded-l-none p-0"
                                // Filtering is live, so the button takes you to the field.
                                onClick={() => searchRef.current?.focus()}
                            >
                                <MagnifyingGlass size={14} />
                            </Button>
                        </div>
                        <Button onClick={startConnect} data-testid="channels-settings-connect">
                            <Plus data-icon="inline-start" />
                            Connect channel
                        </Button>
                    </div>
                    {term && shown.length === 0 ? (
                        <Empty className="rounded-lg border border-border py-14">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <MagnifyingGlass />
                                </EmptyMedia>
                                <EmptyTitle>No channels found</EmptyTitle>
                                <EmptyDescription>
                                    Nothing matches “{search.trim()}”. Try a bot, workspace,
                                    platform or agent name.
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                                <Button variant="outline" onClick={() => setSearch("")}>
                                    Clear search
                                </Button>
                            </EmptyContent>
                        </Empty>
                    ) : (
                        <div className={CARD_GRID}>
                            {shown.map((connection, i) => (
                                <ChannelConnectionCard
                                    key={connection.connectionId ?? i}
                                    connection={connection}
                                    hostedHandle={hostedHandle}
                                    onOpen={() => openConnection(connection)}
                                />
                            ))}
                            <Button
                                variant="ghost"
                                onClick={startConnect}
                                data-testid="channels-settings-new"
                                className="h-auto min-h-[200px] flex-col gap-2.5 rounded-lg border border-dashed border-border text-muted-foreground"
                            >
                                <span className="flex size-[38px] items-center justify-center rounded-[10px] border border-solid border-border bg-background">
                                    <Plus size={16} />
                                </span>
                                <span className="flex flex-col items-center gap-0.5">
                                    <span className="text-[13.5px] font-medium text-foreground">
                                        New connection
                                    </span>
                                    <span className="text-xs font-normal">
                                        Slack, Telegram or WhatsApp
                                    </span>
                                </span>
                            </Button>
                        </div>
                    )}
                </>
            )}

            {panel.panel}
        </div>
    )
}
