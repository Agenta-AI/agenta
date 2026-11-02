import {useState} from "react"

import {CaretRight} from "@phosphor-icons/react"

import {
    CHANNEL_PLATFORMS,
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    agentConnectionsOf,
    connectionLabel,
    hasAnyIssue,
    platformLabel,
    summarizeConnection,
} from "./helpers"
import {platformLogo} from "./icons"
import type {ChannelConnections, ChannelsActions} from "./types"
import {useChannelPanel, type ChannelsPanelRenderProps} from "./useChannelPanel"

/**
 * The agent page's Channels section: connect and manage the chat tools an agent answers in.
 *
 * Reusable across the desktop app and /m. The host supplies the sliding panel container via
 * `renderPanel` (a drawer on desktop, a bottom sheet on /m), the connections it loaded, and
 * the real actions; everything inside — the connect flow and the manage view — is shared.
 *
 * A channel connection is one per project and answers as one agent. Each platform row is in
 * one of three states relative to the agent whose page is open: not connected ("Connect"),
 * connected here (opens the manage view), or connected to another agent ("Connect here",
 * which retargets the connection to this agent).
 */

export type {ChannelsPanelRenderProps}

export interface ChannelsPageProps {
    /** The agent whose page this is; decides "connected here" versus "connected to X". */
    agentId?: string
    agentName?: string
    /** Seeds the description of a new Slack app. */
    agentDescription?: string | null
    workspaceName?: string
    /** The project's connections, as loaded by the host. */
    connections?: ChannelConnections
    /** True while the host is loading `connections` for the first time. */
    loading?: boolean
    loadError?: string | null
    onRetry?: () => Promise<void>
    /** The real actions; defaults to no-op actions for previews. */
    actions?: ChannelsActions
    /** Host-provided sliding container: antd/@agenta drawer on desktop, a Sheet on /m. */
    renderPanel: (props: ChannelsPanelRenderProps) => React.ReactNode
    /** The hosted bot/app handle to show, e.g. "@newagentabot". */
    hostedHandle?: string
}

export const ChannelsPage = ({
    agentId,
    agentName = "your agent",
    agentDescription,
    workspaceName = "your workspace",
    connections = EMPTY_CONNECTIONS,
    loading = false,
    loadError = null,
    onRetry,
    actions = NOOP_ACTIONS,
    renderPanel,
    hostedHandle = "@agenta",
}: ChannelsPageProps) => {
    const [retrying, setRetrying] = useState(false)
    const {open, panel} = useChannelPanel({
        agentId,
        agentName,
        agentDescription,
        workspaceName,
        connections,
        actions,
        renderPanel,
        hostedHandle,
    })

    const anyIssue = hasAnyIssue(connections)
    const nothingConnected = CHANNEL_PLATFORMS.every(
        (platform) => !connections[platform] || connections[platform]?.status === "pending",
    )

    return (
        <div className="flex flex-col gap-4">
            <section className="overflow-hidden rounded-xl border border-solid border-colorBorderSecondary bg-colorBgContainer">
                <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
                    <div className="flex min-w-0 items-center gap-2">
                        <h3 className="m-0 text-base font-semibold text-colorText">Channels</h3>
                        {anyIssue ? (
                            <span className="rounded bg-colorErrorBg px-1.5 py-0.5 text-xs text-colorError">
                                Needs attention
                            </span>
                        ) : null}
                    </div>
                </div>
                <div className="flex flex-col px-4 pb-3">
                    {loadError ? (
                        <div role="alert" className="mb-2 text-xs text-colorError">
                            {loadError}
                            {onRetry ? (
                                <button
                                    type="button"
                                    disabled={retrying}
                                    onClick={async () => {
                                        setRetrying(true)
                                        try {
                                            await onRetry()
                                        } catch {
                                            // The host retains the error until a successful reload.
                                        } finally {
                                            setRetrying(false)
                                        }
                                    }}
                                    className="ml-2 cursor-pointer border-0 bg-transparent text-colorPrimary underline"
                                >
                                    {retrying ? "Retrying…" : "Try again"}
                                </button>
                            ) : null}
                        </div>
                    ) : null}
                    {nothingConnected && !loading && !loadError ? (
                        <p className="m-0 mb-1 text-xs leading-normal text-colorTextSecondary">
                            Talk to {agentName} from the chat tools your team already uses.
                        </p>
                    ) : null}
                    {CHANNEL_PLATFORMS.map((platform) => {
                        const connection = connections[platform]
                        const summary = summarizeConnection(platform, connection, agentId)
                        // Several connections answer as this agent: name each one.
                        const mine = agentConnectionsOf(connections, platform)
                        const sub =
                            mine.length > 1 &&
                            summary.action === "manage" &&
                            !summary.needsAttention
                                ? mine.map((c) => connectionLabel(c, hostedHandle)).join(", ")
                                : summary.sub
                        return (
                            <button
                                key={platform}
                                type="button"
                                disabled={loading || !!loadError}
                                onClick={() => open(platform)}
                                className="flex cursor-pointer items-center gap-2.5 border-0 bg-transparent px-0 py-2.5 text-left disabled:cursor-default"
                                data-testid={`channels-row-${platform}`}
                            >
                                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
                                    {platformLogo(platform, 18)}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-px">
                                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-colorText">
                                        {platformLabel(platform)}
                                        {summary.dotClass ? (
                                            <span
                                                className={`inline-block h-1.5 w-1.5 rounded-full ${summary.dotClass}`}
                                            />
                                        ) : null}
                                    </span>
                                    <span className={`truncate text-xs ${summary.subClass}`}>
                                        {loading ? "Loading…" : loadError ? "Unavailable" : sub}
                                    </span>
                                </span>
                                {loading || loadError ? null : summary.action === "manage" ? (
                                    <CaretRight
                                        size={14}
                                        className="flex-shrink-0 text-colorTextTertiary"
                                    />
                                ) : (
                                    <span className="inline-flex h-6 items-center whitespace-nowrap rounded-md border border-solid border-colorBorder bg-colorBgContainer px-2.5 text-xs text-colorText">
                                        {summary.action === "connect-here"
                                            ? "Connect here"
                                            : "Connect"}
                                    </span>
                                )}
                            </button>
                        )
                    })}
                </div>
            </section>

            {panel}
        </div>
    )
}
